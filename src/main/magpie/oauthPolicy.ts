/** Pinned upstream signin.go/google.go/copilot_signin.go and Claude CLI flow contract. */
export interface MagpieSignInState {
  id: string;
  agent: string;
  url: string;
  state: string;
}
const SUPPORTED_SUBSCRIPTION_SIGN_INS = new Set([
  'codex',
  'copilot',
  'gemini',
  'antigravity',
  'claude',
]);
const GOOGLE_CLIENTS: Record<string, string> = {
  gemini: '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
  antigravity: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
};
function validCallback(value: string | null, agent: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (agent === 'claude' && url.href === 'https://platform.claude.com/oauth/code/callback')
      return true;
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || !url.port)
      return false;
    const paths: Record<string, string> = {
      codex: '/auth/callback',
      gemini: '/oauth2callback',
      antigravity: '/oauth-callback',
      claude: '/callback',
    };
    return url.pathname === paths[agent] && (agent !== 'codex' || url.port === '1455');
  } catch {
    return false;
  }
}
/** Scheme/authority/path/client/PKCE/callback checks plus exact match to active upstream flow. */
export function isAllowedSignInUrl(candidate: string, flow: MagpieSignInState): boolean {
  if (
    flow.state !== 'waiting' ||
    candidate !== flow.url ||
    candidate.length > 8192 ||
    !SUPPORTED_SUBSCRIPTION_SIGN_INS.has(flow.agent)
  )
    return false;
  try {
    // WHATWG URL normalizes unusual spelling; reject it before validation rather than blessing it.
    if (!/^https:\/\/[a-z0-9.-]+\//.test(candidate) || /[\\\u0000-\u0020\u007f]/.test(candidate))
      return false;
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
      return false;
    if (flow.agent === 'copilot')
      return url.origin === 'https://github.com' && url.pathname === '/login/device' && !url.search;
    const q = url.searchParams;
    for (const key of [
      'state',
      'redirect_uri',
      'client_id',
      'response_type',
      'code_challenge',
      'code_challenge_method',
    ]) {
      if (q.getAll(key).length !== 1) return false;
    }
    if (
      !/^[A-Za-z0-9_-]{16,512}$/.test(q.get('state') || '') ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(q.get('code_challenge') || '') ||
      q.get('code_challenge_method') !== 'S256' ||
      q.get('response_type') !== 'code' ||
      !validCallback(q.get('redirect_uri'), flow.agent)
    )
      return false;
    if (flow.agent === 'codex')
      return (
        url.origin === 'https://auth.openai.com' &&
        url.pathname === '/oauth/authorize' &&
        q.get('client_id') === 'app_EMoamEEZ73f0CkXaXp7hrann'
      );
    if (flow.agent === 'gemini' || flow.agent === 'antigravity')
      return (
        url.origin === 'https://accounts.google.com' &&
        url.pathname === '/o/oauth2/v2/auth' &&
        q.get('client_id') === GOOGLE_CLIENTS[flow.agent]
      );
    // Claude Code supplies its actual active URL. Only the currently documented official route
    // is accepted; older CLI authorization domains must be reviewed before being enabled.
    return (
      flow.agent === 'claude' &&
      url.origin === 'https://claude.com' &&
      url.pathname === '/cai/oauth/authorize' &&
      !!q.get('client_id')
    );
  } catch {
    return false;
  }
}

/** Matches window.open to a user-started management request and a live upstream flow, never arbitrary URLs. */
export class MagpieOAuthGate {
  private started?: { agent: string; at: number; generation: number };
  private ids = new Set<string>();
  private generation = 0;
  constructor(
    private readonly readFlow: (id: string) => Promise<MagpieSignInState>,
    private readonly now = Date.now,
  ) {}
  begin(agent: string): boolean {
    this.cancel();
    if (!SUPPORTED_SUBSCRIPTION_SIGN_INS.has(agent)) return false;
    this.started = { agent, at: this.now(), generation: this.generation };
    return true;
  }
  observe(id: string): void {
    if (this.started && /^[A-Za-z0-9_-]{1,80}$/.test(id) && this.ids.size < 8) this.ids.add(id);
  }
  cancel(): void {
    this.generation++;
    this.started = undefined;
    this.ids.clear();
  }
  async allowed(candidate: string): Promise<boolean> {
    const started = this.started;
    if (!started || this.now() - started.at > 10 * 60 * 1000) return false;
    for (const id of this.ids) {
      try {
        const flow = await this.readFlow(id);
        if (started.generation !== this.generation) return false;
        if (flow.agent === started.agent && isAllowedSignInUrl(candidate, flow)) return true;
      } catch {
        /* Unknown, failed or canceled flow cannot open a browser. */
      }
    }
    return false;
  }
}
