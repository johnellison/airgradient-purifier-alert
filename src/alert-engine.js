export const AlertState = Object.freeze({ NORMAL: "normal", PENDING: "pending", ALERT: "alert" });

export function dataFreshness(timestamp, now, staleMinutes = 10, offlineMinutes = 30) {
  if (!timestamp) return { state: "offline", ageMinutes: null };
  const ageMinutes = Math.max(0, (now.getTime() - new Date(timestamp).getTime()) / 60000);
  const state = ageMinutes >= offlineMinutes ? "offline" : ageMinutes >= staleMinutes ? "stale" : "live";
  return { state, ageMinutes };
}

export function evaluateAlert({ current, pm25, timestamp, settings, now = new Date() }) {
  const freshness = dataFreshness(timestamp, now, settings.staleMinutes, settings.offlineMinutes);
  if (freshness.state !== "live" || !Number.isFinite(pm25)) return { next: current, event: null, freshness };
  const at = new Date(timestamp).toISOString();
  if (current.status === AlertState.ALERT) {
    if (pm25 <= settings.clearThreshold) {
      return { next: { status: AlertState.NORMAL, pendingSince: null, changedAt: at }, event: "clear", freshness };
    }
    return { next: current, event: null, freshness };
  }
  if (pm25 >= settings.alertThreshold) {
    const pendingSince = current.status === AlertState.PENDING && current.pendingSince ? current.pendingSince : at;
    const elapsed = (new Date(timestamp).getTime() - new Date(pendingSince).getTime()) / 60000;
    if (elapsed >= settings.durationMinutes) {
      return { next: { status: AlertState.ALERT, pendingSince: null, changedAt: at }, event: "alert", freshness };
    }
    return { next: { status: AlertState.PENDING, pendingSince, changedAt: current.changedAt }, event: null, freshness };
  }
  return { next: { status: AlertState.NORMAL, pendingSince: null, changedAt: current.changedAt }, event: null, freshness };
}
