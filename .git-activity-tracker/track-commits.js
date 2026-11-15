'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { GoogleAuth } = require('google-auth-library');

const SHEET_TITLE = 'Git Activity';
const HEADERS = [
  'Recorded At (UTC)',
  'Project',
  'Repository',
  'Branch',
  'Commit SHA',
  'Commit URL',
  'Author',
  'Author Email',
  'Committed At',
  'Message',
  'Files Changed',
];

const repoRoot = path.resolve(__dirname, '..');

function requireEnv(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function loadCredentials() {
  const raw = requireEnv('GOOGLE_SERVICE_ACCOUNT_JSON');
  let credentials;
  try {
    credentials = JSON.parse(raw);
    if (typeof credentials === 'string') credentials = JSON.parse(credentials);
  } catch {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
    process.exit(1);
  }
  if (!credentials || !credentials.client_email || !credentials.private_key) {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.');
    process.exit(1);
  }
  return credentials;
}

function loadEvent() {
  const eventPath = requireEnv('GITHUB_EVENT_PATH');
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  } catch {
    console.error(`Unable to read the GitHub event payload at ${eventPath}.`);
    process.exit(1);
  }
}

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  });
}

function countFiles(sha) {
  try {
    const out = git(['show', '--name-only', '--format=', '--first-parent', sha]);
    return out.split('\n').filter((line) => line.trim()).length;
  } catch {
    return '';
  }
}

function parseGitRecord(row) {
  const [sha, authorName, authorEmail, committedAt, ...messageParts] = row
    .replace(/\n$/, '')
    .split('\x1f');
  return {
    sha: sha || '',
    authorName: authorName || '',
    authorEmail: authorEmail || '',
    committedAt: committedAt || '',
    message: messageParts.join('\x1f').trim(),
    filesChanged: sha ? countFiles(sha) : '',
  };
}

function listFromGit(before, after) {
  const missing = !before || !after || /^0+$/.test(before) || /^0+$/.test(after);
  if (missing) return null;
  try {
    const output = git([
      'log',
      '-z',
      '--reverse',
      '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%B',
      `${before}..${after}`,
    ]);
    return output.split('\0').filter((row) => row.trim()).map(parseGitRecord);
  } catch {
    console.log('Full git history was unavailable for this push. Using the push payload instead.');
    return null;
  }
}

function listFromEvent(event) {
  if (!Array.isArray(event.commits)) return [];
  return event.commits
    .filter((commit) => commit && commit.id)
    .map((commit) => ({
      sha: commit.id,
      authorName: commit.author?.name || '',
      authorEmail: commit.author?.email || '',
      committedAt: commit.timestamp || '',
      message: (commit.message || '').trim(),
      filesChanged:
        (commit.added?.length || 0) +
        (commit.removed?.length || 0) +
        (commit.modified?.length || 0),
    }));
}

function listCommits(event) {
  const fromGit = listFromGit(event.before, event.after);
  if (fromGit && fromGit.length) return fromGit;
  const fromEvent = listFromEvent(event);
  if (fromEvent.length) return fromEvent;
  return fromGit || [];
}

function sheetRange(a1) {
  return `'${SHEET_TITLE.replace(/'/g, "''")}'!${a1}`;
}

function sheetsError(error) {
  const status = error.response?.status;
  const message = error.response?.data?.error?.message || error.message || 'Google Sheets request failed.';
  const wrapped = new Error(status ? `Google Sheets request failed (${status}): ${message}` : message);
  wrapped.status = status;
  return wrapped;
}

async function sheetsRequest(client, options) {
  try {
    const response = await client.request(options);
    return response.data;
  } catch (error) {
    throw sheetsError(error);
  }
}

async function ensureSheet(client, spreadsheetId, clientEmail) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  let meta;
  try {
    meta = await sheetsRequest(client, {
      url: base,
      params: { fields: 'sheets.properties.title' },
    });
  } catch (error) {
    if (error.status === 403) {
      throw new Error(
        `Google Sheets denied access. Share the spreadsheet with ${clientEmail} as an Editor.`
      );
    }
    if (error.status === 404) {
      throw new Error(
        'Spreadsheet was not found. Check GOOGLE_SHEET_ID and share that spreadsheet with the service account.'
      );
    }
    throw error;
  }

  const titles = (meta.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean);
  if (titles.includes(SHEET_TITLE)) return;

  try {
    await sheetsRequest(client, {
      url: `${base}:batchUpdate`,
      method: 'POST',
      data: { requests: [{ addSheet: { properties: { title: SHEET_TITLE } } }] },
    });
  } catch (error) {
    if (!/already exists/i.test(error.message)) throw error;
  }
}

async function existingCommitKeys(client, spreadsheetId, repository) {
  const range = encodeURIComponent(sheetRange('C:E'));
  const data = await sheetsRequest(client, {
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`,
  });
  const seen = new Set();
  for (const row of data.values || []) {
    const repo = row[0] || '';
    const sha = row[2] || '';
    if (repo === repository && sha) seen.add(sha);
  }
  return seen;
}

async function ensureHeaders(client, spreadsheetId) {
  const range = encodeURIComponent(sheetRange('A1:K1'));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`;
  const existing = await sheetsRequest(client, { url });
  if (existing.values?.[0]?.[0]) return;
  await sheetsRequest(client, {
    url,
    method: 'PUT',
    params: { valueInputOption: 'RAW' },
    data: { values: [HEADERS] },
  });
}

async function appendRows(client, spreadsheetId, rows) {
  const range = encodeURIComponent(sheetRange('A:K'));
  await sheetsRequest(client, {
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:append`,
    method: 'POST',
    params: {
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
    },
    data: { values: rows },
  });
}

async function main() {
  const credentials = loadCredentials();
  const spreadsheetId = requireEnv('GOOGLE_SHEET_ID');
  const repository = requireEnv('GITHUB_REPOSITORY');
  const branch = (process.env.GITHUB_REF_NAME || '').trim();
  const server = (process.env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
  const project = (process.env.PROJECT_NAME || '').trim() || repository;
  const commits = listCommits(loadEvent());

  if (!commits.length) {
    console.log('No commits to record.');
    return;
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();

  await ensureSheet(client, spreadsheetId, credentials.client_email);
  await ensureHeaders(client, spreadsheetId);

  const seen = await existingCommitKeys(client, spreadsheetId, repository);
  const fresh = commits.filter((commit) => commit.sha && !seen.has(commit.sha));
  if (!fresh.length) {
    console.log('All commits in this push are already recorded.');
    return;
  }

  const recordedAt = new Date().toISOString();
  const rows = fresh.map((commit) => [
    recordedAt,
    project,
    repository,
    branch,
    commit.sha,
    `${server}/${repository}/commit/${commit.sha}`,
    commit.authorName,
    commit.authorEmail,
    commit.committedAt,
    commit.message,
    commit.filesChanged,
  ]);

  await appendRows(client, spreadsheetId, rows);
  console.log(`Recorded ${rows.length} commit(s) for ${repository}.`);
}

main().catch((error) => {
  console.error(error.message || 'Git activity tracker failed.');
  process.exit(1);
});
