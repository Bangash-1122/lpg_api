/**
 * Comprehensive verification script for Chatbot API
 * Tests validation, knowledge filtering, deduplication, atomic slot reservation,
 * permission scoping, quota limit & recovery, provider mocking, timeouts, and error handling.
 */

process.env.NODE_ENV = 'test';
process.env.MONGODB_URL = process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/test_brother_lpg';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_min';

const assert = require('assert');
const crypto = require('crypto');
const { chatRequestSchema } = require('../src/validations/chat.validation');
const {
  ERP_WORKFLOW_KNOWLEDGE,
  getWorkflowsForPermissions,
  formatKnowledgeForPrompt,
} = require('../src/chat/knowledge');
const chatProvider = require('../src/services/chatProvider.service');
const chatService = require('../src/services/chat.service');
const env = require('../src/config/env');
const ApiError = require('../src/utils/ApiError');

let passedTests = 0;
let totalTests = 0;

function it(description, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${description}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function itAsync(description, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${description}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('\n--- 1. Request Validation Tests (Zod) ---');

  it('Valid UUID and trimmed nonempty question passes validation', () => {
    const validUuid = crypto.randomUUID();
    const result = chatRequestSchema.safeParse({
      body: {
        requestId: validUuid,
        question: 'How do I create a new sales invoice?',
      },
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.body.requestId, validUuid);
    assert.strictEqual(result.data.body.question, 'How do I create a new sales invoice?');
  });

  it('Rejects non-UUID requestId', () => {
    const result = chatRequestSchema.safeParse({
      body: {
        requestId: 'not-a-valid-uuid-1234',
        question: 'How do I record LPG receipt?',
      },
    });
    assert.strictEqual(result.success, false);
    const hasUuidError = result.error.issues.some((i) => i.message.includes('UUID'));
    assert.strictEqual(hasUuidError, true);
  });

  it('Rejects empty or whitespace-only question', () => {
    const validUuid = crypto.randomUUID();
    const result = chatRequestSchema.safeParse({
      body: {
        requestId: validUuid,
        question: '   ',
      },
    });
    assert.strictEqual(result.success, false);
  });

  it('Rejects question longer than 1,200 characters', () => {
    const validUuid = crypto.randomUUID();
    const result = chatRequestSchema.safeParse({
      body: {
        requestId: validUuid,
        question: 'A'.repeat(1201),
      },
    });
    assert.strictEqual(result.success, false);
    const hasMaxError = result.error.issues.some((i) => i.message.includes('1,200'));
    assert.strictEqual(hasMaxError, true);
  });

  it('Rejects extra unknown fields in request body (strict mode)', () => {
    const validUuid = crypto.randomUUID();
    const result = chatRequestSchema.safeParse({
      body: {
        requestId: validUuid,
        question: 'Valid question',
        extraField: 'not allowed',
      },
    });
    assert.strictEqual(result.success, false);
  });

  console.log('\n--- 2. ERP Knowledge & Permission Filtering Tests ---');

  it('Knowledge base contains verified ERP workflows', () => {
    assert(ERP_WORKFLOW_KNOWLEDGE.length >= 10, 'Expected at least 10 workflow entries');
    const salesWf = ERP_WORKFLOW_KNOWLEDGE.find((w) => w.id === 'sales_invoices');
    assert(salesWf, 'Expected sales_invoices workflow');
    assert.strictEqual(salesWf.screenLabel, 'Sales');
  });

  it('Filters workflows according to user permissions', () => {
    // User with only sales.read
    const salesOnly = getWorkflowsForPermissions(['sales.read']);
    assert(salesOnly.some((w) => w.id === 'sales_invoices'), 'Should include sales_invoices');
    assert(!salesOnly.some((w) => w.id === 'lpg_receipts'), 'Should NOT include lpg_receipts');

    // User with lpg-receipts.read
    const lpgOnly = getWorkflowsForPermissions(['lpg-receipts.read']);
    assert(lpgOnly.some((w) => w.id === 'lpg_receipts'), 'Should include lpg_receipts');
    assert(!lpgOnly.some((w) => w.id === 'sales_invoices'), 'Should NOT include sales_invoices');
  });

  it('Formats prompt knowledge with exact screen labels', () => {
    const workflows = getWorkflowsForPermissions(['sales.read']);
    const promptText = formatKnowledgeForPrompt(workflows);
    assert(promptText.includes('Exact Screen: "Sales"'), 'Prompt must contain exact screen label');
    assert(promptText.includes('New Sale'), 'Prompt must include button names');
  });

  console.log('\n--- 3. Normalization, Fingerprinting & Permission Eligibility ---');

  it('Normalizes question by trimming, lowercasing, and collapsing whitespace', () => {
    const q1 = '  How   DO  I   CREATE A   SALE?  ';
    const normalized = chatService.normalizeQuestion(q1);
    assert.strictEqual(normalized, 'how do i create a sale?');
  });

  it('Produces identical SHA-256 fingerprints for identical normalized questions', () => {
    const q1 = 'How do I add a supplier?';
    const q2 = '  HOW   do   i ADD a   supplier?  ';
    const fp1 = chatService.hashQuestion(chatService.normalizeQuestion(q1));
    const fp2 = chatService.hashQuestion(chatService.normalizeQuestion(q2));
    assert.strictEqual(fp1, fp2);
  });

  it('Permission scoping: Ineligible if user lost permissions held at answer creation', () => {
    const answerPermissions = ['sales.read', 'lpg-receipts.read'];

    // User still has both: eligible
    assert.strictEqual(chatService.isAnswerEligible(answerPermissions, ['sales.read', 'lpg-receipts.read']), true);
    // User gained more: eligible
    assert.strictEqual(chatService.isAnswerEligible(answerPermissions, ['sales.read', 'lpg-receipts.read', 'accounts.read']), true);
    // User lost lpg-receipts.read: INELIGIBLE!
    assert.strictEqual(chatService.isAnswerEligible(answerPermissions, ['sales.read']), false);
  });

  console.log('\n--- 4. Provider Service & Timeout Tests ---');

  await itAsync('Reports 503 unavailable if API key is missing', async () => {
    const savedKey = env.chat.apiKey;
    try {
      env.chat.apiKey = '';
      chatProvider.setMockProvider(null);
      await chatProvider.generateAnswer({
        question: 'How to fill cylinders?',
        allowedWorkflows: [],
      });
      assert.fail('Should have thrown 503');
    } catch (err) {
      assert.strictEqual(err.statusCode, 503);
      assert(err.message.includes('unavailable'), 'Expected service unavailable message');
    } finally {
      env.chat.apiKey = savedKey;
    }
  });

  await itAsync('Mock provider generates answer successfully', async () => {
    chatProvider.setMockProvider(async ({ question, allowedWorkflows }) => {
      return `Answer for: ${question} (Workflows: ${allowedWorkflows.length})`;
    });

    const answer = await chatProvider.generateAnswer({
      question: 'How do I create a customer?',
      allowedWorkflows: getWorkflowsForPermissions(['customers.read']),
    });

    assert(answer.includes('How do I create a customer?'));
    chatProvider.setMockProvider(null);
  });

  console.log('\n--- 5. Service Concurrency, Deduplication & Atomic Quota Tests ---');

  // We test the end-to-end service logic with a simulated in-memory store simulating MongoDB's atomic document locking
  const mockStorage = new Map();

  const { ChatRequestWindow } = require('../src/models');
  // Store original methods to restore after test
  const origFindOne = ChatRequestWindow.findOne;
  const origUpdateOne = ChatRequestWindow.updateOne;
  const origFindOneAndUpdate = ChatRequestWindow.findOneAndUpdate;

  // Install test mocks on ChatRequestWindow
  ChatRequestWindow.findOne = function (query) {
    const userIdStr = String(query.userId);
    const doc = mockStorage.get(userIdStr) || null;
    return {
      lean: async () => (doc ? JSON.parse(JSON.stringify(doc)) : null),
    };
  };

  ChatRequestWindow.updateOne = async function (filter, update, options) {
    const userIdStr = String(filter.userId);
    let doc = mockStorage.get(userIdStr);
    if (!doc && options?.upsert) {
      doc = {
        userId: filter.userId,
        requests: [],
        expiresAt: update.$setOnInsert?.expiresAt || new Date(Date.now() + 3600000),
      };
      mockStorage.set(userIdStr, doc);
      return { matchedCount: 0, upsertedCount: 1 };
    }

    if (doc && filter['requests.reservationId']) {
      const resId = filter['requests.reservationId'];
      const targetReq = doc.requests.find((r) => r.reservationId === resId);
      if (targetReq && update.$set) {
        if (update.$set['requests.$.status']) targetReq.status = update.$set['requests.$.status'];
        if (update.$set['requests.$.answer']) targetReq.answer = update.$set['requests.$.answer'];
        if (update.$set['requests.$.completedAt']) targetReq.completedAt = update.$set['requests.$.completedAt'];
        if (update.$set['requests.$.expiresAt']) targetReq.expiresAt = update.$set['requests.$.expiresAt'];
        if (update.$set['requests.$.error']) targetReq.error = update.$set['requests.$.error'];
      }
    }
    return { matchedCount: 1, modifiedCount: 1 };
  };

  ChatRequestWindow.findOneAndUpdate = async function (filter, update) {
    const userIdStr = String(filter.userId);
    const doc = mockStorage.get(userIdStr);
    if (!doc) return null;

    // Check $nor condition (no active pending entry for this requestId or questionFingerprint)
    const now = new Date();
    const norActive = doc.requests.some(
      (r) =>
        (r.requestId === update.$push.requests.requestId ||
          r.questionFingerprint === update.$push.requests.questionFingerprint) &&
        r.status === 'pending' &&
        new Date(r.expiresAt) > now
    );
    if (norActive) {
      return null; // Reservation rejected due to existing pending entry
    }

    // Check quota limit
    const windowStart = new Date(now.getTime() - (env.chat.quotaWindowSeconds || 60) * 1000);
    const activeInWindow = doc.requests.filter(
      (r) =>
        new Date(r.createdAt) >= windowStart &&
        ['pending', 'completed'].includes(r.status)
    );

    if (activeInWindow.length >= (env.chat.quotaLimit || 10)) {
      return null; // Reservation rejected due to quota limit exceeded
    }

    // Atomically push
    doc.requests.push(update.$push.requests);
    return JSON.parse(JSON.stringify(doc));
  };

  const testUserA = { _id: '507f1f77bcf86cd799439011' };
  const testUserB = { _id: '507f1f77bcf86cd799439022' };

  await itAsync('Generates answer on clean first request (source: generated)', async () => {
    chatProvider.setMockProvider(async ({ question }) => `Mocked answer for: ${question}`);
    mockStorage.clear();

    const reqId = crypto.randomUUID();
    const res = await chatService.processChatRequest({
      user: testUserA,
      permissionCodes: ['sales.read'],
      requestId: reqId,
      question: 'How do I view sales?',
    });

    assert.strictEqual(res.status, 'completed');
    assert.strictEqual(res.source, 'generated');
    assert(res.answer.includes('How do I view sales?'));
  });

  await itAsync('Completed duplicate returns cached answer without calling provider (source: cache)', async () => {
    let providerCalls = 0;
    chatProvider.setMockProvider(async () => {
      providerCalls++;
      return 'Generated answer';
    });

    // Same question submitted with a new UUID (e.g. from another tab)
    const newReqId = crypto.randomUUID();
    const res = await chatService.processChatRequest({
      user: testUserA,
      permissionCodes: ['sales.read'],
      requestId: newReqId,
      question: 'How do I view sales?',
    });

    assert.strictEqual(res.status, 'completed');
    assert.strictEqual(res.source, 'cache');
    assert.strictEqual(providerCalls, 0, 'Provider should NOT have been called on duplicate completed request');
  });

  await itAsync('Rejects UUID reused for different question text (HTTP 400)', async () => {
    const existingReq = mockStorage.get(String(testUserA._id)).requests[0];
    const reusedUuid = existingReq.requestId;

    try {
      await chatService.processChatRequest({
        user: testUserA,
        permissionCodes: ['sales.read'],
        requestId: reusedUuid,
        question: 'Completely different question text',
      });
      assert.fail('Should have rejected reused UUID');
    } catch (err) {
      assert.strictEqual(err.statusCode, 400);
      assert(err.message.includes('requestId has already been used'), 'Expected UUID reuse error message');
    }
  });

  await itAsync('Concurrent identical question receives 202 while first request is pending', async () => {
    mockStorage.clear();
    const reqId1 = crypto.randomUUID();
    const reqId2 = crypto.randomUUID();
    const question = 'How do I record filling batch?';

    // Simulate first request currently pending in database
    const doc = {
      userId: testUserA._id,
      requests: [
        {
          requestId: reqId1,
          reservationId: crypto.randomUUID(),
          questionFingerprint: chatService.hashQuestion(chatService.normalizeQuestion(question)),
          status: 'pending',
          answer: null,
          effectivePermissions: ['filling-batches.read'],
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 15000),
          completedAt: null,
        },
      ],
      expiresAt: new Date(Date.now() + 3600000),
    };
    mockStorage.set(String(testUserA._id), doc);

    let providerCalled = false;
    chatProvider.setMockProvider(async () => {
      providerCalled = true;
      return 'Batch answer';
    });

    const res = await chatService.processChatRequest({
      user: testUserA,
      permissionCodes: ['filling-batches.read'],
      requestId: reqId2,
      question,
    });

    assert.strictEqual(res.status, 'pending');
    assert.strictEqual(res.retryAfter, 2);
    assert.strictEqual(providerCalled, false, 'Concurrent request must NOT invoke provider');
  });

  await itAsync('Quota enforcement: Temporarily set limit to 2 to verify 429 and Retry-After', async () => {
    mockStorage.clear();
    const savedLimit = env.chat.quotaLimit;
    env.chat.quotaLimit = 2; // Temporarily set limit to 2 as requested

    chatProvider.setMockProvider(async ({ question }) => `Answer: ${question}`);

    try {
      // Slot 1
      const res1 = await chatService.processChatRequest({
        user: testUserA,
        permissionCodes: ['sales.read'],
        requestId: crypto.randomUUID(),
        question: 'Question 1',
      });
      assert.strictEqual(res1.status, 'completed');

      // Slot 2
      const res2 = await chatService.processChatRequest({
        user: testUserA,
        permissionCodes: ['sales.read'],
        requestId: crypto.randomUUID(),
        question: 'Question 2',
      });
      assert.strictEqual(res2.status, 'completed');

      // Slot 3: Must be rate limited with HTTP 429
      try {
        await chatService.processChatRequest({
          user: testUserA,
          permissionCodes: ['sales.read'],
          requestId: crypto.randomUUID(),
          question: 'Question 3 (exceeds limit)',
        });
        assert.fail('Should have been rate-limited with 429');
      } catch (err) {
        assert.strictEqual(err.statusCode, 429);
        assert(err.retryAfter > 0, 'Expected positive retryAfter value');
      }
    } finally {
      env.chat.quotaLimit = savedLimit;
    }
  });

  await itAsync('User isolation: User B can make requests while User A is quota-exhausted', async () => {
    const savedLimit = env.chat.quotaLimit;
    env.chat.quotaLimit = 2;

    try {
      // User A is already at limit 2 from previous test
      // User B makes a request: should succeed!
      const resB = await chatService.processChatRequest({
        user: testUserB,
        permissionCodes: ['sales.read'],
        requestId: crypto.randomUUID(),
        question: 'User B question',
      });

      assert.strictEqual(resB.status, 'completed');
      assert.strictEqual(resB.source, 'generated');
    } finally {
      env.chat.quotaLimit = savedLimit;
    }
  });

  await itAsync('Quota recovery: After rolling window passes, new requests succeed', async () => {
    const savedLimit = env.chat.quotaLimit;
    env.chat.quotaLimit = 2;

    try {
      const docA = mockStorage.get(String(testUserA._id));
      // Age User A's previous requests so they are outside the rolling window
      const ancientTime = new Date(Date.now() - 120000); // 2 minutes ago
      docA.requests.forEach((r) => {
        r.createdAt = ancientTime;
      });

      // Now User A requests again: quota has recovered!
      const resRecovered = await chatService.processChatRequest({
        user: testUserA,
        permissionCodes: ['sales.read'],
        requestId: crypto.randomUUID(),
        question: 'Question after quota window recovered',
      });

      assert.strictEqual(resRecovered.status, 'completed');
    } finally {
      env.chat.quotaLimit = savedLimit;
    }
  });

  await itAsync('Permission change invalidates broader cached answer', async () => {
    mockStorage.clear();
    chatProvider.setMockProvider(async () => 'Sales and LPG info');

    // User A generates answer with broader permissions: ['sales.read', 'lpg-receipts.read']
    const req1 = crypto.randomUUID();
    const question = 'What are current gas receipts?';
    await chatService.processChatRequest({
      user: testUserA,
      permissionCodes: ['sales.read', 'lpg-receipts.read'],
      requestId: req1,
      question,
    });

    let reGenerated = false;
    chatProvider.setMockProvider(async () => {
      reGenerated = true;
      return 'New answer under reduced permissions';
    });

    // Now User A's permissions are reduced to ONLY ['sales.read'] (lost lpg-receipts.read)
    // Asking the same question should NOT reuse the cached answer created under broader permissions
    const resAfterPermLoss = await chatService.processChatRequest({
      user: testUserA,
      permissionCodes: ['sales.read'], // Lost lpg-receipts.read
      requestId: crypto.randomUUID(),
      question,
    });

    assert.strictEqual(resAfterPermLoss.source, 'generated');
    assert.strictEqual(reGenerated, true, 'Must re-generate answer under current permissions');
  });

  await itAsync('Provider failure records failed status tied to reservationId', async () => {
    mockStorage.clear();
    chatProvider.setMockProvider(async () => {
      throw new ApiError(504, 'AI provider timed out.');
    });

    const reqId = crypto.randomUUID();
    try {
      await chatService.processChatRequest({
        user: testUserA,
        permissionCodes: ['sales.read'],
        requestId: reqId,
        question: 'Question that times out',
      });
      assert.fail('Should have thrown 504');
    } catch (err) {
      assert.strictEqual(err.statusCode, 504);
      // Verify reservation was recorded with status 'failed'
      const doc = mockStorage.get(String(testUserA._id));
      const failedReq = doc.requests.find((r) => r.requestId === reqId);
      assert(failedReq, 'Failed request should be recorded');
      assert.strictEqual(failedReq.status, 'failed');
    }
  });

  // Restore ChatRequestWindow methods
  ChatRequestWindow.findOne = origFindOne;
  ChatRequestWindow.updateOne = origUpdateOne;
  ChatRequestWindow.findOneAndUpdate = origFindOneAndUpdate;
  chatProvider.setMockProvider(null);

  console.log(`\n========================================`);
  console.log(`Tests finished: ${passedTests}/${totalTests} passed`);
  console.log(`========================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
