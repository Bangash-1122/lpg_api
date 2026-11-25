const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { formatKnowledgeForPrompt } = require('../chat/knowledge');

let mockProviderFn = null;

/**
 * Configure or clear a mock provider for automated testing.
 * @param {Function|null} fn - Mock generator function receiving { question, allowedWorkflows }
 */
function setMockProvider(fn) {
  mockProviderFn = fn;
}

/**
 * Builds the system instruction prompt incorporating permitted ERP knowledge.
 *
 * @param {Array} allowedWorkflows - List of workflows accessible under user's permissions
 * @returns {string} System prompt
 */
function buildSystemPrompt(allowedWorkflows = []) {
  const knowledgeText = formatKnowledgeForPrompt(allowedWorkflows);

  return [
    'You are the official AI Assistant for Brother LPG Cylinder Plant ERP.',
    'Your goal is to guide plant staff with clear, concise, step-by-step instructions.',
    '',
    'Rules:',
    '1. Answer using ONLY the verified ERP workflows provided below.',
    '2. Use exact ERP screen labels and button names in double quotes (e.g. "Sales", "LPG Receipts", "Filling Batches").',
    '3. Keep instructions concise, direct, and numbered in logical order.',
    '4. If the question cannot be answered from the provided workflows, or if the user lacks access, explicitly state that no instructions are available or ask the user for the specific ERP screen name.',
    '5. Never invent or hallucinate non-existent ERP screens or features.',
    '',
    '--- VERIFIED ERP WORKFLOW GUIDE ---',
    knowledgeText,
    '--- END OF ERP WORKFLOW GUIDE ---',
  ].join('\n');
}

/**
 * Calls Google Gemini REST API.
 */
async function callGemini({ apiKey, apiUrl, model, prompt, systemInstruction, timeoutMs, maxTokens }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const endpoint = `${apiUrl.replace(/\/+$/, '')}/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.2,
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new ApiError(502, 'AI provider rate limit reached. Please try again in a few moments.');
      }
      throw new ApiError(502, `AI provider error (HTTP ${response.status}).`);
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const textPart = candidate?.content?.parts?.[0]?.text;

    if (!textPart) {
      throw new ApiError(502, 'AI provider returned an empty response.');
    }

    return textPart.trim();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(504, 'Chat service timed out waiting for AI provider response.');
    }
    if (err.isOperational) {
      throw err;
    }
    throw new ApiError(502, 'AI provider connection failed. Please try again.');
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Calls OpenAI-compatible chat completions REST API.
 */
async function callOpenAICompatible({ apiKey, apiUrl, model, prompt, systemInstruction, timeoutMs, maxTokens }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const endpoint = apiUrl.endsWith('/chat/completions')
    ? apiUrl
    : `${apiUrl.replace(/\/+$/, '')}/chat/completions`;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokens,
    temperature: 0.2,
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new ApiError(502, 'AI provider rate limit reached. Please try again in a few moments.');
      }
      throw new ApiError(502, `AI provider error (HTTP ${response.status}).`);
    }

    const data = await response.json();
    const message = data?.choices?.[0]?.message?.content;

    if (!message) {
      throw new ApiError(502, 'AI provider returned an empty response.');
    }

    return message.trim();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(504, 'Chat service timed out waiting for AI provider response.');
    }
    if (err.isOperational) {
      throw err;
    }
    throw new ApiError(502, 'AI provider connection failed. Please try again.');
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Calls the configured AI provider to generate an answer for the user's question.
 *
 * @param {Object} params
 * @param {string} params.question - Validated user question
 * @param {Array} params.allowedWorkflows - Workflows the user has permissions to see
 * @returns {Promise<string>} Model response text
 */
async function generateAnswer({ question, allowedWorkflows = [] }) {
  // If mock provider is set (e.g. during testing), invoke it directly
  if (typeof mockProviderFn === 'function') {
    return mockProviderFn({ question, allowedWorkflows });
  }

  const { apiKey, apiUrl, provider, model, timeoutMs, maxTokens } = env.chat || {};

  // If AI key is missing, report chat service unavailable (HTTP 503) without failing ERP startup
  if (!apiKey) {
    throw new ApiError(503, 'Chat service is currently unavailable. AI provider API key is not configured.');
  }

  const systemInstruction = buildSystemPrompt(allowedWorkflows);

  const isGemini = provider === 'gemini';

  if (isGemini) {
    return callGemini({
      apiKey,
      apiUrl: apiUrl || 'https://generativelanguage.googleapis.com/v1beta/models',
      model: model || 'gemini-1.5-flash',
      prompt: question,
      systemInstruction,
      timeoutMs: timeoutMs || 15000,
      maxTokens: maxTokens || 600,
    });
  }

  return callOpenAICompatible({
    apiKey,
    apiUrl: apiUrl || 'https://api.openai.com/v1',
    model: model || 'gpt-6.2-astra',
    prompt: question,
    systemInstruction,
    timeoutMs: timeoutMs || 15000,
    maxTokens: maxTokens || 600,
  });
}

module.exports = {
  generateAnswer,
  setMockProvider,
  buildSystemPrompt,
};
