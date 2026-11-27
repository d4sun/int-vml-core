export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "INTERNAL"

export type FieldErrors = Record<string, string[]>

export type AppErrorOptions = {
  details?: unknown
  fieldErrors?: FieldErrors
  cause?: unknown
}

/**
 * Base class for expected, typed failures. Services throw these; route
 * handlers and server actions map them to a response. Anything else is a bug
 * and must never leak its message to a client.
 */
export class AppError extends Error {
  readonly code: AppErrorCode
  readonly status: number
  readonly details?: unknown
  readonly fieldErrors?: FieldErrors

  constructor(
    message: string,
    code: AppErrorCode = "INTERNAL",
    status = 500,
    options: AppErrorOptions = {}
  ) {
    super(message, { cause: options.cause })
    this.name = new.target.name
    this.code = code
    this.status = status
    this.details = options.details
    this.fieldErrors = options.fieldErrors
  }
}

/** No valid session: the caller must sign in. Distinct from FORBIDDEN. */
export class UnauthenticatedError extends AppError {
  constructor(message = "Sign in to continue", options: AppErrorOptions = {}) {
    super(message, "UNAUTHENTICATED", 401, options)
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", options: AppErrorOptions = {}) {
    super(message, "NOT_FOUND", 404, options)
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = "You do not have access to this resource",
    options: AppErrorOptions = {}
  ) {
    super(message, "FORBIDDEN", 403, options)
  }
}

/** Too many requests in a short time (CR-8). The caller should wait and try again. */
export class RateLimitedError extends AppError {
  constructor(
    message = "Too many changes in a short time. Try again in a few minutes.",
    options: AppErrorOptions = {}
  ) {
    super(message, "RATE_LIMITED", 429, options)
  }
}

export class ConflictError extends AppError {
  constructor(
    message = "This action conflicts with the current state",
    options: AppErrorOptions = {}
  ) {
    super(message, "CONFLICT", 409, options)
  }
}

export class ValidationError extends AppError {
  constructor(
    message = "Invalid input",
    fieldErrors?: FieldErrors,
    options: AppErrorOptions = {}
  ) {
    super(message, "VALIDATION", 422, { ...options, fieldErrors })
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

/**
 * Normalises any thrown value into an AppError. Unknown errors become a
 * generic internal error: their message and stack stay server-side.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error

  return new AppError("Something went wrong", "INTERNAL", 500, {
    cause: error,
  })
}
