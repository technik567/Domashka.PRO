import catalog from '../../shared/public-demos.json';

// Fixed, distinct public demos, not aliases for a single router. Metadata checks
// are NOT proof of successful anonymous inference; see docs/PUBLIC_DEMOS.md.
export const PUBLIC_DEMOS = catalog.models;
export const PUBLIC_DEMO_TIMEOUT_MS = catalog.requestTimeoutMs;
export const PUBLIC_DEMO_LIMITS = { response: catalog.maxResponseChars, event: catalog.maxEventChars };
const byId = new Map(PUBLIC_DEMOS.map((model) => [model.id, model]));
export function getPublicDemo(id) { return byId.get(id) || null; }
