/**
 * Typed error classification for Cowork / AI agent errors.
 *
 * Replaces the regex-based classifyErrorKey() in coworkErrorClassify.ts
 * with a structured CoworkError model that preserves metadata through the
 * IPC boundary, enabling differentiated user prompts, log levels, and
 * automatic recovery strategies.
 *
 * Corresponds to OpenHuman's rpc_handler error classification in
 * src/core/jsonrpc.rs — each kind maps to a distinct log level and
 * Sentry reporting policy.
 */

// ─── Error Kind ─────────────────────────────────────────────────────────────

export const CoworkErrorKind = {
  /** API key invalid/expired — user must update credentials */
  AuthExpired: 'auth_expired',
  /** Rate limit / overloaded — transient, can retry after delay */
  RateLimited: 'rate_limited',
  /** Insufficient balance / quota exceeded — user must top up */
  BudgetExceeded: 'budget_exceeded',
  /** Input too long / context length exceeded */
  InputTooLong: 'input_too_long',
  /** Model not found / not available */
  ModelNotFound: 'model_not_found',
  /**
   * The server rejected a modality the client sent — deterministic, retrying
   * with the same payload always fails (e.g. llama.cpp without an mmproj
   * vision projector answering "image input is not supported").
   */
  ModelCapabilityUnsupported: 'model_capability_unsupported',
  /** The provider/model this session uses is disabled or no longer configured */
  ProviderUnavailable: 'provider_unavailable',
  /** Content filtered by moderation */
  ContentFiltered: 'content_filtered',
  /** Gateway disconnected unexpectedly */
  GatewayDisconnected: 'gateway_disconnected',
  /** Gateway draining for restart */
  GatewayDraining: 'gateway_draining',
  /** Agent runtime not ready (starting or recovering) */
  EngineNotReady: 'engine_not_ready',
  /** Network error (ECONNREFUSED, ENOTFOUND, ETIMEDOUT) */
  NetworkError: 'network_error',
  /** Upstream server error (5xx) */
  ServerError: 'server_error',
  StreamInterrupted: 'stream_interrupted',
  TurnTimeout: 'turn_timeout',
  FileWriteTruncated: 'file_write_truncated',
  /** Tool execution timeout */
  ToolTimeout: 'tool_timeout',
  /** Tool execution permission denied */
  ToolPermissionDenied: 'tool_permission_denied',
  /** Max iterations exceeded in agent loop */
  MaxIterations: 'max_iterations',
  /** Service restart in progress */
  ServiceRestart: 'service_restart',
  /** PDF processing failure */
  CouldNotProcessPdf: 'could_not_process_pdf',
  /** Unclassified / unknown error */
  Unknown: 'unknown',
} as const;

export type CoworkErrorKind = (typeof CoworkErrorKind)[keyof typeof CoworkErrorKind];

// ─── CoworkError ────────────────────────────────────────────────────────────

/** Structured error object that replaces bare `error: string` throughout the system. */
export interface CoworkError {
  /** Machine-readable error category */
  kind: CoworkErrorKind;
  /** Human-readable message (may be the original upstream error text) */
  message: string;
  /** HTTP status code, if available */
  statusCode?: number;
  /** Suggested retry delay in milliseconds (e.g. from Retry-After header) */
  retryAfterMs?: number;
  /** Provider that returned the error (e.g. 'anthropic', 'deepseek') */
  provider?: string;
  /** Unique request identifier for debugging */
  requestId?: string;
  /** Original raw error string before classification */
  raw?: string;
}

// ─── Error Classification Rules ─────────────────────────────────────────────

interface ErrorRule {
  kind: CoworkErrorKind;
  pattern: RegExp;
  /** Extract metadata like statusCode from the error string */
  extract?: (error: string) => Partial<CoworkError>;
}

/**
 * Classification rules ordered by specificity.
 *
 * Unlike the old regex-array approach, each rule independently maps to
 * a specific CoworkErrorKind — there is no positional dependency between
 * rules because they produce typed output rather than a flat i18n key.
 * The first match wins, so more specific patterns should come first.
 */
const RULES: ErrorRule[] = [
  // ── Auth (most specific first) ──────────────────────────────────────────
  {
    kind: CoworkErrorKind.AuthExpired,
    pattern:
      /authentication[_\s](?:error|fails?)|api[_\s]key.*(?:invalid|expired|not[_\s]valid)|invalid.*api.*key|incorrect.*api.*key|unauthorized|PERMISSION_DENIED|\b401\b/i,
    extract: () => ({ statusCode: 401 }),
  },

  // ── Rate limit (must precede budget — "RESOURCE_EXHAUSTED: quota exceeded" is rate-limit, not billing) ──
  {
    kind: CoworkErrorKind.RateLimited,
    pattern: /\b429\b|rate[_\s]limit|too many requests|overloaded|RESOURCE_EXHAUSTED/i,
    extract: () => ({ statusCode: 429 }),
  },

  // ── Budget ──────────────────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.BudgetExceeded,
    pattern:
      /insufficient.*(?:balance|quota|credits)|billing|quota[_\s]exceeded|Arrearage|account.*not.*in.*good.*standing|余额不足|\b402\b/i,
    extract: () => ({ statusCode: 402 }),
  },

  // ── Input too long ──────────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.InputTooLong,
    pattern:
      /input.*too.*long|context.*length.*exceeded|range of input length|\b413\b|payload.*too.*large|request.*entity.*too.*large|max[_\s]tokens/i,
    extract: () => ({ statusCode: 413 }),
  },

  // ── Model not found ─────────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.ModelNotFound,
    pattern: /model.*not.*(?:found|exist)/i,
  },

  // ── Provider unavailable (disabled or model removed since the session ran) ──
  {
    kind: CoworkErrorKind.ProviderUnavailable,
    pattern: /provider\s+\S.*\bis not enabled\b|no enabled provider found/i,
  },

  // ── Content filtered ────────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.ContentFiltered,
    pattern:
      /DataInspectionFailed|content.*(?:review|filter)|审核未通过|未通过.*审核|inappropriate.*content|\b451\b|flagged.*input/i,
    extract: () => ({ statusCode: 451 }),
  },

  // ── Gateway draining (before disconnected — more specific) ──────────────
  {
    kind: CoworkErrorKind.GatewayDraining,
    pattern: /gateway.*draining|draining.*restart/i,
  },

  // ── Gateway disconnected ────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.GatewayDisconnected,
    pattern: /gateway.*disconnect|client disconnected/i,
  },

  // ── Service restart ─────────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.ServiceRestart,
    pattern: /service restart/i,
  },

  // ── Network ─────────────────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.NetworkError,
    pattern:
      /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|could not connect|connection.*refused|network.*error/i,
  },

  // ── Model capability mismatch (must precede ServerError: llama.cpp without a
  // vision projector answers 500 "image input is not supported … mmproj", which
  // /50[023]/ would otherwise classify as a transient server error) ────────────
  {
    kind: CoworkErrorKind.ModelCapabilityUnsupported,
    // A bare "mmproj" mention is not a capability verdict (logs mention the
    // projector when loading it, too) — only failure wording after it counts.
    pattern:
      /image input is not supported|mmproj[^"\n]*(?:missing|not\s+\w+|fail\w*|unsupported)|does not support (?:image|vision|audio|video)(?: input)?|modality not supported/i,
    extract: (error: string) => {
      const m = error.match(/\b([45]\d{2})\b/);
      return m ? { statusCode: parseInt(m[1], 10) } : {};
    },
  },

  // ── Server ──────────────────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.ServerError,
    pattern: /internal.server.error|bad.gateway|service.unavailable|\b50[023]\b/i,
    extract: (error: string) => {
      const m = error.match(/\b(50[023])\b/);
      return m ? { statusCode: parseInt(m[1], 10) } : {};
    },
  },

  // ── PDF ─────────────────────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.CouldNotProcessPdf,
    pattern: /could not process pdf/i,
  },

  // ── Stream interrupted ──────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.StreamInterrupted,
    // An abort or a dropped stream. Deliberately narrow: matching a bare
    // "terminated" would swallow unrelated upstream wording.
    pattern:
      /\baborted\b|operation was aborted|socket hang up|premature close|stream (?:was )?(?:closed|interrupted)|ECONNRESET/i,
  },

  // ── Turn timeout / truncated writes ─────────────────────────────────────
  // Both kinds are also set explicitly by the runtime when it knows the cause;
  // the patterns keep the text-only paths (conversation status lines, IPC
  // strings) classified instead of leaking English to the UI.
  {
    kind: CoworkErrorKind.TurnTimeout,
    pattern: /produced no output for|turn exceeded .* without finishing|turn was stopped/i,
  },
  {
    kind: CoworkErrorKind.FileWriteTruncated,
    pattern: /file mutation payload was truncated|chunked-write guidance/i,
  },

  // ── Tool timeout ────────────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.ToolTimeout,
    pattern: /tool.*timed?[_\s]?out|execution.*timed?[_\s]?out|timed?[_\s]?out.*tool/i,
  },

  // ── Tool permission ─────────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.ToolPermissionDenied,
    pattern: /permission.*denied.*tool|tool.*permission.*denied|not allowed to use/i,
  },

  // ── Max iterations ──────────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.MaxIterations,
    pattern: /max[_\s]iterations|too many iterations|iteration limit/i,
  },

  // ── Engine not ready ────────────────────────────────────────────────────
  {
    kind: CoworkErrorKind.EngineNotReady,
    pattern: /engine.*not.*ready|gateway.*not.*ready|not.*running/i,
  },

  // ── Unknown (catch-all from upstream wrappers) ──────────────────────────
  {
    kind: CoworkErrorKind.Unknown,
    pattern: /unknown error|an unknown error occurred/i,
  },
];

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * Classify a raw error string into a structured CoworkError.
 * Returns Unknown kind if no rule matches.
 */
export function classifyCoworkError(rawError: string): CoworkError {
  // Find first matching rule
  for (const rule of RULES) {
    if (rule.pattern.test(rawError)) {
      return {
        kind: rule.kind,
        message: rawError,
        raw: rawError,
        ...(rule.extract ? rule.extract(rawError) : {}),
      };
    }
  }

  // No match — return unknown
  return {
    kind: CoworkErrorKind.Unknown,
    message: rawError,
    raw: rawError,
  };
}

/**
 * Convenience: classify + keep existing API compatibility.
 * Returns a CoworkError with the given kind and message.
 */
export function makeCoworkError(
  kind: CoworkErrorKind,
  message: string,
  extra?: Partial<CoworkError>,
): CoworkError {
  return { kind, message, ...extra };
}

// ─── Log Level ──────────────────────────────────────────────────────────────

export type ErrorLogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * Map each error kind to the appropriate log level.
 *
 * Analogous to OpenHuman's rpc_handler error category → log level mapping:
 *   - expected_user_state → info
 *   - param_validation → warn
 *   - session_expired → info
 *   - transient_message_failure → debug
 *   - actionable → error + Sentry
 */
export function getErrorLogLevel(kind: CoworkErrorKind): ErrorLogLevel {
  switch (kind) {
    // User-actionable — user must fix something
    case CoworkErrorKind.AuthExpired:
    case CoworkErrorKind.BudgetExceeded:
    case CoworkErrorKind.InputTooLong:
    case CoworkErrorKind.ModelNotFound:
    case CoworkErrorKind.ModelCapabilityUnsupported:
    case CoworkErrorKind.ProviderUnavailable:
    case CoworkErrorKind.ContentFiltered:
    case CoworkErrorKind.CouldNotProcessPdf:
      return 'error';

    // Transient — auto-recoverable, warn level
    case CoworkErrorKind.RateLimited:
    case CoworkErrorKind.NetworkError:
    case CoworkErrorKind.ServerError:
    case CoworkErrorKind.GatewayDisconnected:
    case CoworkErrorKind.GatewayDraining:
    case CoworkErrorKind.ServiceRestart:
    case CoworkErrorKind.ToolTimeout:
      return 'warn';

    // Expected states — informational
    case CoworkErrorKind.EngineNotReady:
    case CoworkErrorKind.MaxIterations:
      return 'info';

    // Debug-level noise
    case CoworkErrorKind.ToolPermissionDenied:
      return 'debug';

    default:
      return 'error';
  }
}

// ─── Transience ─────────────────────────────────────────────────────────────

/** Whether the error kind is transient and should be auto-retried. */
export function isTransient(kind: CoworkErrorKind): boolean {
  switch (kind) {
    case CoworkErrorKind.RateLimited:
    case CoworkErrorKind.NetworkError:
    case CoworkErrorKind.ServerError:
    case CoworkErrorKind.GatewayDisconnected:
    case CoworkErrorKind.GatewayDraining:
    case CoworkErrorKind.ServiceRestart:
    case CoworkErrorKind.ToolTimeout:
    case CoworkErrorKind.StreamInterrupted:
      return true;

    default:
      return false;
  }
}

// ─── User-facing i18n key ───────────────────────────────────────────────────

/** Map error kind to the i18n key for user-facing error messages. */
export function getUserErrorI18nKey(kind: CoworkErrorKind): string {
  switch (kind) {
    case CoworkErrorKind.AuthExpired:
      return 'coworkErrorAuthInvalid';
    case CoworkErrorKind.RateLimited:
      return 'coworkErrorRateLimit';
    case CoworkErrorKind.BudgetExceeded:
      return 'coworkErrorInsufficientBalance';
    case CoworkErrorKind.InputTooLong:
      return 'coworkErrorInputTooLong';
    case CoworkErrorKind.ModelNotFound:
      return 'coworkErrorModelNotFound';
    case CoworkErrorKind.ModelCapabilityUnsupported:
      return 'coworkErrorModelCapabilityUnsupported';
    case CoworkErrorKind.ProviderUnavailable:
      return 'coworkErrorProviderUnavailable';
    case CoworkErrorKind.ContentFiltered:
      return 'coworkErrorContentFiltered';
    case CoworkErrorKind.GatewayDisconnected:
      return 'coworkErrorGatewayDisconnected';
    case CoworkErrorKind.GatewayDraining:
      return 'coworkErrorGatewayDraining';
    case CoworkErrorKind.EngineNotReady:
      return 'coworkErrorEngineNotReady';
    case CoworkErrorKind.NetworkError:
      return 'coworkErrorNetworkError';
    case CoworkErrorKind.ServerError:
      return 'coworkErrorServerError';
    case CoworkErrorKind.StreamInterrupted:
      return 'coworkErrorStreamInterrupted';
    case CoworkErrorKind.TurnTimeout:
      return 'coworkErrorTurnTimeout';
    case CoworkErrorKind.FileWriteTruncated:
      return 'coworkErrorFileWriteTruncated';
    case CoworkErrorKind.ToolTimeout:
      return 'coworkErrorToolTimeout';
    case CoworkErrorKind.ToolPermissionDenied:
      return 'coworkErrorToolPermissionDenied';
    case CoworkErrorKind.MaxIterations:
      return 'coworkErrorMaxIterations';
    case CoworkErrorKind.ServiceRestart:
      return 'coworkErrorServiceRestart';
    case CoworkErrorKind.CouldNotProcessPdf:
      return 'coworkErrorCouldNotProcessPdf';
    case CoworkErrorKind.Unknown:
      return 'coworkErrorUnknown';
    default:
      return 'coworkErrorUnknown';
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Error code returned by IPC when the agent runtime is not ready. */
export const ENGINE_NOT_READY_CODE = 'ENGINE_NOT_READY' as const;
