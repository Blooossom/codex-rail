export const initialState = () => ({
  connected: false, threadId: null, model: null, fast: null,
  context: null, weekly: null, resetsAt: null, status: 'connecting', turnActive: false,
  updatedAt: Date.now(), quotaAt: null, modelChangedAt: null,
});
export const clamp = n => Math.max(0, Math.min(100, n));
const finite = n => typeof n === 'number' && Number.isFinite(n);

export function quotaWindow(result, model) {
  const buckets = result.rateLimitsByLimitId || {};
  const matching = Object.values(buckets).filter(b => b?.normalModelSlug === model);
  const candidates = [...matching, buckets.codex, result.rateLimits].filter(Boolean);
  for (const bucket of candidates) {
    for (const window of [bucket.primary, bucket.secondary]) {
      if (window?.windowDurationMins === 7 * 24 * 60 && finite(window.usedPercent)) {
        return { weekly: clamp(window.usedPercent), resetsAt: finite(window.resetsAt) ? window.resetsAt : null };
      }
    }
  }
  return { weekly: null, resetsAt: null };
}

/** Observe protocol metadata only. Never persist prompts, results, auth, or approval decisions. */
export class RailState {
  constructor(onChange = () => {}) {
    this.value = initialState();
    this.onChange = onChange;
    this.requests = new Map();
    this.approvals = new Set();
    this.quota = null;
  }
  patch(update) {
    Object.assign(this.value, update, { updatedAt: Date.now() });
    this.onChange({ ...this.value });
  }
  settings(settings) {
    const update = {};
    if (typeof settings.model === 'string') {
      update.model = settings.model;
      if (this.value.model && this.value.model !== settings.model) update.modelChangedAt = Date.now();
    }
    if ('serviceTier' in settings) update.fast = settings.serviceTier === 'fast' || settings.serviceTier === 'priority';
    if (this.quota && update.model) Object.assign(update, quotaWindow(this.quota, update.model));
    this.patch(update);
  }
  client(message) {
    const p = message.params || {};
    if (message.id != null && message.method) {
      // Retain only fields necessary to associate responses; no user input or credentials.
      this.requests.set(message.id, { method: message.method, threadId: p.threadId,
        threadSource: p.threadSource,
        model: p.model, ...(Object.hasOwn(p, 'serviceTier') ? { serviceTier: p.serviceTier } : {}) });
      if (message.method === 'turn/start' && p.threadId === this.value.threadId) {
        this.patch({ status: 'working', turnActive: true });
      }
    }
  }
  rateLimits(result) {
    this.quota = result;
    this.patch({ ...quotaWindow(result, this.value.model), quotaAt: Date.now() });
  }
  server(message) {
    const p = message.params || {};
    if (message.id != null && !message.method) {
      const request = this.requests.get(message.id);
      this.requests.delete(message.id);
      if (!request) return;
      if (message.error) {
        if (['turn/start', 'thread/compact/start'].includes(request.method) && request.threadId === this.value.threadId) this.patch({ status: 'error', turnActive: false });
        return;
      }
      const r = message.result || {};
      if (['thread/start', 'thread/resume', 'thread/fork'].includes(request.method) && r.thread) {
        // The CLI also starts background threads (e.g. Luna generates titles).
        // Those responses share this connection but must not steal HUD focus.
        // Untagged threads remain supported for older servers/clients.
        const source = r.thread.threadSource ?? request.threadSource;
        if (source != null && source !== 'user') return;
        this.approvals.clear();
        this.patch({ threadId: r.thread.id, context: null, status: 'idle', turnActive: false });
        this.settings(r);
        this.runtimeStatus(r.thread.status);
      } else if (['thread/settings/update', 'turn/settings/update', 'turn/start'].includes(request.method)) {
        if (!request.threadId || request.threadId === this.value.threadId) this.settings(request);
      } else if (request.method === 'account/rateLimits/read') this.rateLimits(r);
      return;
    }
    if (message.method === 'account/rateLimits/updated') { this.rateLimits(p); return; }
    if (!this.value.threadId || p.threadId !== this.value.threadId) return;
    switch (message.method) {
      case 'thread/settings/updated': this.settings(p.threadSettings || {}); break;
      case 'thread/status/changed': this.runtimeStatus(p.status); break;
      case 'thread/tokenUsage/updated': {
        const usage = p.tokenUsage;
        // last is the latest model context; total is cumulative lifetime usage.
        this.patch({ context: usage?.modelContextWindow > 0 && finite(usage?.last?.totalTokens)
          ? clamp(100 * usage.last.totalTokens / usage.modelContextWindow) : null });
        break;
      }
      case 'turn/started': this.approvals.clear(); this.patch({ status: 'working', turnActive: true }); break;
      case 'turn/completed':
        this.approvals.clear();
        this.patch({ status: p.turn?.status === 'failed' ? 'error' : p.turn?.status === 'completed' ? 'done' : 'idle', turnActive: false });
        break;
      case 'item/started':
        if (p.item?.type === 'contextCompaction') this.patch({ status: 'compacting' });
        break;
      case 'item/completed':
        if (p.item?.type === 'contextCompaction' && this.value.status === 'compacting') this.patch({ status: 'working' });
        break;
      case 'error': this.patch({ status: p.willRetry ? 'working' : 'error', turnActive: Boolean(p.willRetry) }); break;
      case 'serverRequest/resolved':
        this.approvals.delete(p.requestId);
        if (!this.approvals.size && ['approval', 'waiting'].includes(this.value.status)) this.patch({ status: 'working' });
        break;
      default:
        if (message.method?.endsWith('/requestApproval') || message.method === 'item/tool/requestUserInput') {
          this.approvals.add(message.id);
          this.patch({ status: message.method.endsWith('/requestApproval') ? 'approval' : 'waiting' });
        }
    }
  }
  runtimeStatus(status) {
    if (!status) return;
    if (status.type === 'active') {
      const flags = status.activeFlags || [];
      this.patch({ turnActive: true, status: flags.includes('waitingOnApproval') ? 'approval' : flags.includes('waitingOnUserInput') ? 'waiting'
        : this.value.status === 'compacting' ? 'compacting' : 'working' });
    } else if (status.type === 'systemError') this.patch({ status: 'error', turnActive: false });
    else if (status.type === 'idle' && !this.value.turnActive && !['done', 'error'].includes(this.value.status)) this.patch({ status: 'idle' });
    else if (status.type === 'notLoaded') this.patch({ status: 'idle', turnActive: false });
  }
}
