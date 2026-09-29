import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeNetworkError,
  fetchWithOneRetry,
  isSafeToRetry,
} from '../../../packages/shared-types/src/network.ts';

/**
 * فشل الشبكة اللحظي (docs/08 §187): قراءة بتتعاد مرة، والكتابة عمرها ما بتتعاد.
 */
const noSleep = async () => {};
const ok = new Response('{}', { status: 200 });

function flaky(failures) {
  let calls = 0;
  const run = async () => {
    calls += 1;
    if (calls <= failures) throw new TypeError('Failed to fetch');
    return ok;
  };
  return { run, calls: () => calls };
}

test('قراءة: فشل شبكة واحد بيتعاد مرة وبينجح', async () => {
  const f = flaky(1);
  assert.equal(await fetchWithOneRetry(f.run, { method: 'GET' }, noSleep), ok);
  assert.equal(f.calls(), 2);
});

test('قراءة: فشلين ورا بعض ⇒ الخطأ بيطلع بعد محاولتين بس', async () => {
  const f = flaky(5);
  await assert.rejects(fetchWithOneRetry(f.run, {}, noSleep), /Failed to fetch/);
  assert.equal(f.calls(), 2);
});

test('كتابة: POST/PATCH/DELETE مابيتعادوش أبدًا (ممكن ينفّذوا مرتين)', async () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'post']) {
    const f = flaky(1);
    await assert.rejects(fetchWithOneRetry(f.run, { method }, noSleep));
    assert.equal(f.calls(), 1, method);
  }
});

test('طلب اتلغى عمدًا (AbortSignal) مابيتعادش', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const run = async () => {
    calls += 1;
    throw new DOMException('aborted', 'AbortError');
  };
  await assert.rejects(fetchWithOneRetry(run, { signal: controller.signal }, noSleep));
  assert.equal(calls, 1);
});

test('رد من السيرفر (حتى 500) مابيتعادش — ده مش فشل شبكة', async () => {
  let calls = 0;
  const serverError = new Response('{}', { status: 500 });
  const res = await fetchWithOneRetry(async () => { calls += 1; return serverError; }, {}, noSleep);
  assert.equal(res.status, 500);
  assert.equal(calls, 1);
});

test('isSafeToRetry: GET افتراضي', () => {
  assert.equal(isSafeToRetry(undefined), true);
  assert.equal(isSafeToRetry('HEAD'), true);
  assert.equal(isSafeToRetry('POST'), false);
});

test('describeNetworkError بيضيف السياق لو الجهاز offline', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try {
    assert.equal(describeNetworkError(new TypeError('Failed to fetch')), 'Failed to fetch [offline]');
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
  assert.equal(describeNetworkError(new TypeError('Failed to fetch')), 'Failed to fetch');
});
