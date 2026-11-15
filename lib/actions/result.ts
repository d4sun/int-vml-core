import { ZodError } from "zod"
import {
  isAppError,
  toAppError,
  ValidationError,
  type AppError,
  type AppErrorCode,
  type FieldErrors,
} from "@/lib/errors"

export type ActionErrorState = {
  status: "error"
  code: AppErrorCode
  message: string
  fieldErrors?: FieldErrors
}

export type ActionState<T> = { status: "success"; data: T } | ActionErrorState

export type HttpErrorResponse = {
  status: number
  body: {
    error: {
      code: AppErrorCode
      message: string
      fieldErrors?: FieldErrors
    }
  }
}

function fromZodError(error: ZodError): ValidationError {
  const fieldErrors: FieldErrors = {}

  for (const issue of error.issues) {
    const field = issue.path.join(".") || "form"
    fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message]
  }

  return new ValidationError(
    "Please check the highlighted fields.",
    fieldErrors
  )
}

/** Normalises Zod and unknown errors into the one typed shape we map from. */
export function toNormalizedError(error: unknown): AppError {
  if (error instanceof ZodError) return fromZodError(error)
  return isAppError(error) ? error : toAppError(error)
}

/**
 * Expected errors are returned from server actions, never thrown: React's
 * `useActionState` renders this shape directly.
 */
export function toActionState(error: unknown): ActionErrorState {
  const appError = toNormalizedError(error)

  return {
    status: "error",
    code: appError.code,
    message: appError.message,
    ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
  }
}

/** For route handlers (Stripe webhook, auth callbacks). */
export function toHttpResponse(error: unknown): HttpErrorResponse {
  const appError = toNormalizedError(error)

  return {
    status: appError.status,
    body: {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
      },
    },
  }
}

export async function runAction<T>(
  work: () => Promise<T>
): Promise<ActionState<T>> {
  try {
    return { status: "success", data: await work() }
  } catch (error) {
    return toActionState(error)
  }
}
