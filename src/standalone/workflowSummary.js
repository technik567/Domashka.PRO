// Compact public action receipt. No draft responses, provider payloads,
// prompts, private reasoning, auth fields or keys belong in stored history.
const count = (value, max) => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : 0;
export function cleanWorkflow(value) {
  if (!value || typeof value !== 'object' || !['off','low','medium','high'].includes(value.level)) return undefined;
  return {
    level: value.level, calls: count(value.calls, 4), searches: count(value.searches, 2), verified: count(value.verified, 2),
    elapsedMs: count(value.elapsedMs, 480000),
    trail: Array.isArray(value.trail) ? value.trail.slice(0,24).filter(e => e && typeof e.message === 'string').map((e,i) => ({
      id: i+1, stage: String(e.stage || '').slice(0,40), state: ['done','warning'].includes(e.state) ? e.state : 'warning',
      message: e.message.slice(0,300), elapsedMs: count(e.elapsedMs,480000),
      // A query is transient in advanced view, not part of a backup receipt.
    })) : [],
  };
}
