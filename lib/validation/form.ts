import type { ZodError } from "zod"

export type FieldErrors = Record<string, string>

/** Key used for issues that do not belong to a single field. */
export const FORM_ERROR_KEY = "_form"

/**
 * Collapses a zod error into one message per field (the first issue wins), so
 * forms can render server-grade validation without a form library.
 */
export function fieldErrors(error: ZodError): FieldErrors {
  const errors: FieldErrors = {}

  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || FORM_ERROR_KEY
    errors[key] ??= issue.message
  }

  return errors
}
