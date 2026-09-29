export const WORKFORCE_HEARTBEAT_INTERVAL_MS = 30_000;
export const WORKFORCE_IDLE_THRESHOLD_MS = 300_000;
const MAX_HEARTBEAT_GAP_MS = 360_000;
const FIRST_HEARTBEAT_MS = 10_000;

type HeartbeatSender = (reset: boolean, keepalive: boolean) => void;

export function startWorkforceActivityTracker(send: HeartbeatSender): () => void {
  let lastHeartbeatAt = Date.now();
  let lastInteractionAt = lastHeartbeatAt;
  let idle = document.visibilityState !== 'visible';
  let hiddenAt: number | null = idle ? lastHeartbeatAt : null;
  let hasBeenVisible = !idle;
  let firstHeartbeat: number | null = null;

  function heartbeat(reset: boolean, keepalive = false) {
    lastHeartbeatAt = Date.now();
    send(reset, keepalive);
    if (reset && document.visibilityState === 'visible') {
      if (firstHeartbeat !== null) window.clearTimeout(firstHeartbeat);
      firstHeartbeat = window.setTimeout(() => {
        firstHeartbeat = null;
        if (document.visibilityState === 'visible' && !idle &&
          Date.now() - lastHeartbeatAt >= FIRST_HEARTBEAT_MS) heartbeat(false);
      }, FIRST_HEARTBEAT_MS);
    }
  }

  function onInteraction() {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    const wasIdle = idle || now - lastHeartbeatAt > MAX_HEARTBEAT_GAP_MS ||
      now - lastInteractionAt > WORKFORCE_IDLE_THRESHOLD_MS;
    lastInteractionAt = now;
    if (wasIdle) {
      idle = false;
      heartbeat(true);
    } else if (now - lastHeartbeatAt >= WORKFORCE_HEARTBEAT_INTERVAL_MS) heartbeat(false);
  }

  function stopVisiblePeriod() {
    if (hiddenAt !== null) return;
    if (firstHeartbeat !== null) {
      window.clearTimeout(firstHeartbeat);
      firstHeartbeat = null;
    }
    if (!idle && Date.now() - lastInteractionAt <= WORKFORCE_IDLE_THRESHOLD_MS &&
      Date.now() - lastHeartbeatAt >= 1_000 && Date.now() - lastHeartbeatAt <= MAX_HEARTBEAT_GAP_MS) {
      heartbeat(false, true);
    }
    hiddenAt = Date.now();
    idle = true;
  }

  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') {
      stopVisiblePeriod();
      return;
    }
    if (hiddenAt === null) return;
    const awayMs = Date.now() - hiddenAt;
    const canResume = hasBeenVisible && awayMs <= WORKFORCE_IDLE_THRESHOLD_MS &&
      Date.now() - lastInteractionAt <= WORKFORCE_IDLE_THRESHOLD_MS &&
      Date.now() - lastHeartbeatAt <= MAX_HEARTBEAT_GAP_MS;
    hiddenAt = null;
    hasBeenVisible = true;
    idle = false;
    lastInteractionAt = Date.now();
    heartbeat(!canResume);
  }

  const events = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart'] as const;
  for (const event of events) document.addEventListener(event, onInteraction, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', stopVisiblePeriod);
  heartbeat(true);

  return () => {
    if (firstHeartbeat !== null) window.clearTimeout(firstHeartbeat);
    for (const event of events) document.removeEventListener(event, onInteraction);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', stopVisiblePeriod);
  };
}
