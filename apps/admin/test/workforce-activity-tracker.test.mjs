import assert from 'node:assert/strict';
import test from 'node:test';
import { startWorkforceActivityTracker } from '../src/lib/workforce-activity-tracker.ts';
import { formatActiveTime } from '../src/lib/workforce-time.ts';

function trackerHarness(t, initiallyVisible = true) {
  const originalDateNow = Date.now;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  let now = 1_000_000;
  let nextTimerId = 1;
  const timers = new Map();
  const listeners = new Map();
  const calls = [];
  const document = {
    visibilityState: initiallyVisible ? 'visible' : 'hidden',
    addEventListener(name, handler) { listeners.set(`document:${name}`, handler); },
    removeEventListener(name) { listeners.delete(`document:${name}`); },
  };
  const window = {
    addEventListener(name, handler) { listeners.set(`window:${name}`, handler); },
    removeEventListener(name) { listeners.delete(`window:${name}`); },
    setTimeout(handler, delay) {
      const id = nextTimerId++;
      timers.set(id, { at: now + delay, handler });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  Date.now = () => now;
  globalThis.document = document;
  globalThis.window = window;
  const stop = startWorkforceActivityTracker((reset, keepalive) => calls.push({ at: now, reset, keepalive }));
  t.after(() => {
    stop();
    Date.now = originalDateNow;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  });
  function advance(ms) {
    const target = now + ms;
    while (true) {
      const due = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > target) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].handler();
    }
    now = target;
  }
  function dispatch(name, target = 'document') { listeners.get(`${target}:${name}`)?.(); }
  function visible(value) {
    document.visibilityState = value ? 'visible' : 'hidden';
    dispatch('visibilitychange');
  }
  return { calls, advance, dispatch, visible };
}

function creditedSeconds(calls) {
  return calls.reduce((sum, call, index) => {
    if (call.reset || index === 0) return sum;
    const gapSeconds = (call.at - calls[index - 1].at) / 1_000;
    return sum + (gapSeconds <= 360 ? Math.min(gapSeconds, 300) : 0);
  }, 0);
}

test('the first ten seconds are recorded and displayed without rounding to zero minutes', (t) => {
  const { calls, advance } = trackerHarness(t);
  advance(10_000);
  assert.deepEqual(calls.at(-1), { at: 1_010_000, reset: false, keepalive: false });
  assert.equal(creditedSeconds(calls), 10);
  assert.equal(formatActiveTime(10), '10 ثانية');
});

test('40 minutes of continuous input are saved without waiting for a browser interval', (t) => {
  const { calls, advance, dispatch } = trackerHarness(t);
  for (let i = 0; i < 120; i += 1) {
    advance(20_000);
    dispatch('keydown');
  }
  assert.equal(creditedSeconds(calls), 2_400);
  assert.equal(calls.filter((call) => call.reset).length, 1);
});

test('switching tabs briefly preserves the work period and counts the short return', (t) => {
  const { calls, advance, dispatch, visible } = trackerHarness(t);
  for (let i = 0; i < 8; i += 1) {
    dispatch('pointerdown');
    advance(120_000);
    dispatch('keydown');
    visible(false);
    advance(10_000);
    visible(true);
  }
  assert.equal(creditedSeconds(calls), 1_040);
  assert.equal(calls.filter((call) => call.reset).length, 1);
});

test('a one-hour abandoned tab does not accumulate one hour', (t) => {
  const { calls, advance, dispatch } = trackerHarness(t);
  dispatch('keydown');
  advance(60 * 60_000);
  assert.equal(creditedSeconds(calls), 10);
  dispatch('pointermove');
  assert.equal(calls.at(-1).reset, true);
  advance(10_000);
  assert.equal(creditedSeconds(calls), 20);
});

test('a four-minute thinking pause counts when work resumes', (t) => {
  const { calls, advance, dispatch } = trackerHarness(t);
  dispatch('keydown');
  advance(4 * 60_000);
  dispatch('keydown');
  assert.equal(creditedSeconds(calls), 240);
  assert.equal(calls.at(-1).reset, false);
});

test('page hide saves even an eight-second partial period with keepalive', (t) => {
  const { calls, advance, dispatch, visible } = trackerHarness(t);
  dispatch('keydown');
  advance(8_000);
  visible(false);
  dispatch('pagehide', 'window');
  assert.deepEqual(calls.at(-1), { at: 1_008_000, reset: false, keepalive: true });
  assert.equal(creditedSeconds(calls), 8);
});

test('four minutes in another tab may count when the employee returns', (t) => {
  const { calls, advance, dispatch, visible } = trackerHarness(t);
  advance(30_000);
  dispatch('keydown');
  visible(false);
  advance(4 * 60_000);
  visible(true);
  assert.equal(creditedSeconds(calls), 270);
  assert.equal(calls.at(-1).reset, false);
});

test('one hour away in another tab is not counted; returning restarts the clock', (t) => {
  const { calls, advance, dispatch, visible } = trackerHarness(t);
  advance(30_000);
  dispatch('keydown');
  visible(false);
  advance(60 * 60_000);
  visible(true);
  assert.equal(calls.at(-1).reset, true);
  assert.equal(creditedSeconds(calls), 30);
  advance(10_000);
  assert.equal(creditedSeconds(calls), 40);
});

test('short tab absence is not credited after more than five minutes without any input', (t) => {
  const { calls, advance, visible } = trackerHarness(t);
  advance(4 * 60_000);
  visible(false);
  advance(4 * 60_000);
  visible(true);
  assert.equal(calls.at(-1).reset, true);
  assert.equal(creditedSeconds(calls), 240);
});

test('an initially hidden page does not credit background time but credits ten visible seconds', (t) => {
  const { calls, advance, visible } = trackerHarness(t, false);
  advance(4 * 60_000);
  assert.equal(creditedSeconds(calls), 0);
  visible(true);
  assert.equal(calls.at(-1).reset, true);
  advance(10_000);
  assert.equal(creditedSeconds(calls), 10);
});
