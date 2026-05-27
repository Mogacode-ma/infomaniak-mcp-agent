/**
 * Typed error hierarchy for Infomaniak API calls.
 *
 * Every thrown error in this package extends `InfomaniakError` so callers
 * can use `instanceof` checks reliably. Each error carries an `actionable`
 * field with a suggestion on how to recover (shown to end users / agents).
 */

export interface InfomaniakErrorOptions {
  message: string;
  actionable?: string | undefined;
  status?: number | undefined;
  code?: string | undefined;
  cause?: unknown;
  details?: Record<string, unknown> | undefined;
}

/** Base error class — all package errors extend this. */
export class InfomaniakError extends Error {
  public readonly actionable: string;
  public readonly status: number | undefined;
  public readonly code: string | undefined;
  public readonly details: Record<string, unknown> | undefined;

  constructor(options: InfomaniakErrorOptions) {
    super(options.message, options.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.actionable = options.actionable ?? "No automated suggestion available.";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }

  /** Stable machine-readable error type. Sub-classes override. */
  public get errorType(): string {
    return "infomaniak_error";
  }

  /** Render a structured payload for tool responses. */
  public toToolError(): {
    content: Array<{ type: "text"; text: string }>;
    structuredContent: Record<string, unknown>;
    isError: true;
  } {
    const parts = [`❌ ${this.message}`];
    if (this.code) {
      parts.push(`Code: ${this.code}`);
    }
    if (this.status) {
      parts.push(`HTTP status: ${this.status}`);
    }
    parts.push(`→ ${this.actionable}`);
    return {
      content: [{ type: "text", text: parts.join("\n") }],
      structuredContent: {
        error: true,
        error_type: this.errorType,
        message: this.message,
        code: this.code,
        status: this.status,
        actionable: this.actionable,
      },
      isError: true,
    };
  }
}

/** Authentication problem — token missing, expired, or insufficient. */
export class InfomaniakAuthError extends InfomaniakError {
  public override get errorType(): string {
    return "auth_failure";
  }
}

/** Hit Infomaniak's hard rate limit (60 req/min). */
export class InfomaniakRateLimitError extends InfomaniakError {
  public readonly retryAfterMs: number;

  constructor(options: InfomaniakErrorOptions & { retryAfterMs: number }) {
    super(options);
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Server returned validation_failed — payload missing required fields. */
export class InfomaniakValidationError extends InfomaniakError {
  public readonly missingFields: ReadonlyArray<string>;

  constructor(options: InfomaniakErrorOptions & { missingFields: ReadonlyArray<string> }) {
    super(options);
    this.missingFields = options.missingFields;
  }
}

/** Resource not found (404 / object_not_found). */
export class InfomaniakNotFoundError extends InfomaniakError {}

/** CSRF token mismatch — manager session is stale or token invalid. */
export class InfomaniakCsrfError extends InfomaniakError {}

/** Generic unexpected server error. */
export class InfomaniakServerError extends InfomaniakError {}

/**
 * Map an HTTP error response to the appropriate typed error.
 *
 * Centralizes the mapping logic so new endpoints inherit consistent
 * error handling out of the box.
 */
export function mapHttpError(
  status: number,
  body: unknown,
  context: { method: string; path: string },
): InfomaniakError {
  const errorPayload = isErrorPayload(body) ? body.error : null;
  const code = errorPayload?.code;
  const description = errorPayload?.description ?? `HTTP ${status}`;
  const baseDetails = { method: context.method, path: context.path, body };

  if (status === 401 || code === "not_authorized") {
    return new InfomaniakAuthError({
      message: `Authorization required for ${context.method} ${context.path}`,
      actionable:
        "Make sure your token is valid and you are logged into manager.infomaniak.com in Chrome (auto mode), or refresh INFOMANIAK_SASESSION (manual mode).",
      status,
      code: code ?? undefined,
      details: baseDetails,
    });
  }
  if (status === 403 && code === "forbidden") {
    return new InfomaniakAuthError({
      message: description,
      actionable:
        "This route is locked behind elevated session security. Re-login on manager.infomaniak.com may be required.",
      status,
      code,
      details: baseDetails,
    });
  }
  if (status === 419 || code === "token_mismatch") {
    return new InfomaniakCsrfError({
      message: "CSRF token mismatch",
      actionable:
        "MANAGER-XSRF-TOKEN is missing, stale, or wasn't URL-decoded for the X-XSRF-TOKEN header. Refresh cookies and retry.",
      status,
      code: code ?? undefined,
      details: baseDetails,
    });
  }
  if (status === 422 && code === "validation_failed") {
    const errors = isValidationPayload(body) ? body.error.errors : [];
    const missingFields = errors
      .filter((e) => e.code?.startsWith("validation_rule_required"))
      .map((e) => e.context?.attribute)
      .filter((field): field is string => Boolean(field));
    return new InfomaniakValidationError({
      message: `Validation failed for ${context.method} ${context.path}`,
      actionable:
        missingFields.length > 0
          ? `Missing required fields: ${missingFields.join(", ")}`
          : "Check the payload — see details for the full validation report.",
      status,
      code,
      missingFields,
      details: baseDetails,
    });
  }
  if (status === 429) {
    return new InfomaniakRateLimitError({
      message: "Infomaniak rate limit hit (60 req/min)",
      actionable: "Wait 60 seconds before retrying. The MCP throttles automatically.",
      status,
      code: "rate_limit",
      retryAfterMs: 60_000,
      details: baseDetails,
    });
  }
  if (status === 404 || code === "method_not_found" || code === "object_not_found") {
    return new InfomaniakNotFoundError({
      message: description,
      actionable: `The endpoint ${context.path} does not exist or the resource was deleted.`,
      status,
      code: code ?? undefined,
      details: baseDetails,
    });
  }
  return new InfomaniakServerError({
    message: description,
    actionable:
      "Unexpected server response — check details. If it persists, report the issue with the request_id.",
    status,
    code: code ?? undefined,
    details: baseDetails,
  });
}

interface ErrorPayload {
  result: "error";
  error: { code?: string; description?: string };
}

interface ValidationPayload {
  result: "error";
  error: {
    code: "validation_failed";
    errors: Array<{ code?: string; description?: string; context?: { attribute?: string } }>;
  };
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { result?: unknown }).result === "error" &&
    typeof (value as { error?: unknown }).error === "object"
  );
}

function isValidationPayload(value: unknown): value is ValidationPayload {
  return (
    isErrorPayload(value) && Array.isArray((value as { error: { errors?: unknown } }).error.errors)
  );
}
