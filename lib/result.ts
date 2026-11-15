import type { AppError } from "./errors"

/**
 * Explicit success/failure value. Services may return this where a caller is
 * expected to branch on the outcome instead of catching.
 */
export type Result<T, E = AppError> =
  { ok: true; value: T } | { ok: false; error: E }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<E = AppError>(error: E): Result<never, E> {
  return { ok: false, error }
}

export function isOk<T, E>(
  result: Result<T, E>
): result is { ok: true; value: T } {
  return result.ok
}

export function mapResult<T, E, U>(
  result: Result<T, E>,
  map: (value: T) => U
): Result<U, E> {
  return result.ok ? { ok: true, value: map(result.value) } : result
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback
}
