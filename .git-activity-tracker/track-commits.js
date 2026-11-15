'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { GoogleAuth } = require('google-auth-library');

const TIMEZONE = 'Asia/Karachi';
const HEADER_ROW = 7;
const FIRST_DATA_ROW = 8;
const LAST_DATA_ROW = 1003;
const LEGACY_SHEET = 'Git Activity';

const repoRoot = path.resolve(__dirname, '..');

function requireEnv(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function spreadsheetIdFrom(value) {
  const cleaned = value.trim().replace(/^['"]|['"]$/g, '');
  const fromUrl = cleaned.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) {
    console.log('GOOGLE_SHEET_ID is a spreadsheet URL. Using the id from that URL.');
    return fromUrl[1];
  }
  if (/^https?:\/\//i.test(cleaned) || !/^[a-zA-Z0-9-_]+$/.test(cleaned)) {
    console.error('GOOGLE_SHEET_ID must be the spreadsheet id or a full Google Sheets URL.');
    process.exit(1);
  }
  return cleaned;
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

function quoteSheet(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

function valuesUrl(spreadsheetId, range) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
}

function plain(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (/^[=+\-@]/.test(text)) return `'${text}`;
  return text;
}

function karachiParts(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { day: '', time: '', recorded: '', utc: '' };
  const bag = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  const day = `${bag.year}-${bag.month}-${bag.day}`;
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .replace(/[\u202f\u00a0]/g, ' ');
  return {
    day,
    time,
    recorded: `${day} ${bag.hour}:${bag.minute}:${bag.second}`,
    utc: date.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

function dashboardRow(commit, recordedAtIso) {
  const committed = karachiParts(commit.committedAt);
  const recorded = karachiParts(recordedAtIso);
  const url = commit.url || '';
  return [
    commit.sha,
    plain(commit.project),
    plain(commit.repository),
    plain(commit.message),
    plain(commit.authorName),
    plain(commit.authorEmail),
    plain(commit.branch),
    committed.day,
    committed.time,
    TIMEZONE,
    `=HYPERLINK("${url.replace(/"/g, '""')}","View Commit ↗")`,
    recorded.recorded,
    committed.utc,
  ];
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

function accessError(error, clientEmail) {
  if (error.status === 403) {
    return new Error(
      `Google Sheets denied access. Share the spreadsheet with ${clientEmail} as an Editor.`
    );
  }
  if (error.status === 404) {
    return new Error(
      `Spreadsheet was not found for ${clientEmail}. In Google Sheets, click Share and add that address as an Editor. Access via "anyone with the link" does not apply to a service account.`
    );
  }
  return error;
}

async function getSpreadsheet(client, spreadsheetId, clientEmail) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  try {
    return await sheetsRequest(client, {
      url,
      params: { fields: 'sheets(properties(sheetId,title),tables(tableId,range))' },
    });
  } catch (error) {
    if (error.status === 400) {
      return sheetsRequest(client, {
        url,
        params: { fields: 'sheets(properties(sheetId,title))' },
      });
    }
    throw accessError(error, clientEmail);
  }
}

async function findDashboard(client, spreadsheetId, sheets) {
  for (const sheet of sheets) {
    const title = sheet.properties?.title;
    if (!title || title === LEGACY_SHEET) continue;
    const data = await sheetsRequest(client, {
      url: valuesUrl(spreadsheetId, `${quoteSheet(title)}!A${HEADER_ROW}`),
    });
    if ((data.values?.[0]?.[0] || '').trim() === 'Commit SHA') return sheet;
  }
  throw new Error('The commit table was not found. Expected "Commit SHA" in cell A7 of the dashboard sheet.');
}

async function recordedShas(client, spreadsheetId, title) {
  const data = await sheetsRequest(client, {
    url: valuesUrl(spreadsheetId, `${quoteSheet(title)}!A${FIRST_DATA_ROW}:A${LAST_DATA_ROW}`),
  });
  const shas = new Set();
  let lastRow = HEADER_ROW;
  (data.values || []).forEach((row, index) => {
    const sha = (row[0] || '').trim();
    if (!sha) return;
    shas.add(sha);
    lastRow = FIRST_DATA_ROW + index;
  });
  return { shas, nextRow: lastRow + 1 };
}

async function legacyCommits(client, spreadsheetId, sheets) {
  const sheet = (sheets || []).find((item) => item.properties?.title === LEGACY_SHEET);
  if (!sheet) return [];
  const data = await sheetsRequest(client, {
    url: valuesUrl(spreadsheetId, `${quoteSheet(LEGACY_SHEET)}!A1:K${LAST_DATA_ROW}`),
  });
  const rows = data.values || [];
  const start = (rows[0]?.[0] || '').trim() === 'Recorded At (UTC)' ? 1 : 0;
  return rows.slice(start).flatMap((row) => {
    const sha = (row[4] || '').trim();
    if (!sha) return [];
    return [{
      sha,
      project: row[1] || '',
      repository: row[2] || '',
      branch: row[3] || '',
      url: row[5] || '',
      authorName: row[6] || '',
      authorEmail: row[7] || '',
      committedAt: row[8] || '',
      message: row[9] || '',
    }];
  });
}

async function writeRows(client, spreadsheetId, title, startRow, rows) {
  const endRow = startRow + rows.length - 1;
  if (endRow > LAST_DATA_ROW) {
    throw new Error(`The dashboard table is full at row ${LAST_DATA_ROW}.`);
  }
  await sheetsRequest(client, {
    url: valuesUrl(spreadsheetId, `${quoteSheet(title)}!A${startRow}:M${endRow}`),
    method: 'PUT',
    params: { valueInputOption: 'USER_ENTERED' },
    data: { values: rows },
  });
  return endRow;
}

async function expandTable(client, spreadsheetId, sheet, endRow) {
  const table = (sheet.tables || []).find((item) => item.tableId && item.range);
  if (!table) return;
  const currentEnd = table.range.endRowIndex || 0;
  if (currentEnd >= endRow) return;
  try {
    await sheetsRequest(client, {
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      method: 'POST',
      data: {
        requests: [{
          updateTable: {
            table: {
              tableId: table.tableId,
              range: {
                sheetId: sheet.properties.sheetId,
                startRowIndex: table.range.startRowIndex,
                endRowIndex: endRow,
                startColumnIndex: table.range.startColumnIndex,
                endColumnIndex: table.range.endColumnIndex,
              },
            },
            fields: 'range',
          },
        }],
      },
    });
  } catch {
    console.log('Commit rows were written. The table border was left unchanged.');
  }
}

async function removeLegacySheet(client, spreadsheetId, sheets, shas) {
  const legacy = (sheets || []).find((item) => item.properties?.title === LEGACY_SHEET);
  if (!legacy) return;
  const copied = await legacyCommits(client, spreadsheetId, [legacy]);
  if (copied.some((commit) => !shas.has(commit.sha))) return;
  await sheetsRequest(client, {
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    method: 'POST',
    data: { requests: [{ deleteSheet: { sheetId: legacy.properties.sheetId } }] },
  });
  console.log('Removed the extra Git Activity tab. The dashboard sheet is the record.');
}

async function main() {
  const credentials = loadCredentials();
  const spreadsheetId = spreadsheetIdFrom(requireEnv('GOOGLE_SHEET_ID'));
  const repository = requireEnv('GITHUB_REPOSITORY');
  const branch = (process.env.GITHUB_REF_NAME || '').trim();
  const server = (process.env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
  const project = (process.env.PROJECT_NAME || '').trim() || repository;
  const pushed = listCommits(loadEvent()).map((commit) => ({
    sha: commit.sha,
    project,
    repository,
    branch,
    url: `${server}/${repository}/commit/${commit.sha}`,
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    committedAt: commit.committedAt,
    message: commit.message,
  }));

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const spreadsheet = await getSpreadsheet(client, spreadsheetId, credentials.client_email);
  const sheets = spreadsheet.sheets || [];
  const dashboard = await findDashboard(client, spreadsheetId, sheets);
  const title = dashboard.properties.title;
  const recorded = await recordedShas(client, spreadsheetId, title);
  const earlier = await legacyCommits(client, spreadsheetId, sheets);
  const seen = new Set();
  const fresh = [...earlier, ...pushed].filter((commit) => {
    if (!commit.sha || recorded.shas.has(commit.sha) || seen.has(commit.sha)) return false;
    seen.add(commit.sha);
    return true;
  });

  if (!fresh.length) {
    console.log('All commits in this push are already on the dashboard.');
    await removeLegacySheet(client, spreadsheetId, sheets, recorded.shas);
    return;
  }

  const recordedAt = new Date().toISOString();
  const rows = fresh.map((commit) => dashboardRow(commit, recordedAt));
  const endRow = await writeRows(client, spreadsheetId, title, recorded.nextRow, rows);
  await expandTable(client, spreadsheetId, dashboard, endRow);
  fresh.forEach((commit) => recorded.shas.add(commit.sha));
  await removeLegacySheet(client, spreadsheetId, sheets, recorded.shas);
  console.log(`Recorded ${rows.length} commit(s) on ${title}.`);
}

main().catch((error) => {
  console.error(error.message || 'Git activity tracker failed.');
  process.exit(1);
});
