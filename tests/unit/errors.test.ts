import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  AppError,
  ConflictError,
  ForbiddenError,
  isAppError,
  NotFoundError,
  toAppError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors"
import { toActionState, toHttpResponse, runAction } from "@/lib/actions/result"
import { err, isOk, mapResult, ok, unwrapOr } from "@/lib/result"

describe("typed errors", () => {
  it("TC-E0S0-05: maps each error class to its status and code", () => {
    const table = [
      {
        error: new UnauthenticatedError(),
        status: 401,
        code: "UNAUTHENTICATED",
      },
      { error: new NotFoundError(), status: 404, code: "NOT_FOUND" },
      { error: new ForbiddenError(), status: 403, code: "FORBIDDEN" },
      { error: new ConflictError(), status: 409, code: "CONFLICT" },
      { error: new ValidationError(), status: 422, code: "VALIDATION" },
      { error: new AppError("boom"), status: 500, code: "INTERNAL" },
    ] as const

    for (const row of table) {
      expect(row.error.status).toBe(row.status)
      expect(row.error.code).toBe(row.code)
      expect(isAppError(row.error)).toBe(true)
    }
  })

  it("TC-E0S0-06: unknown errors become a generic internal error", () => {
    const cause = new Error("connection string leaked here")
    const normalised = toAppError(cause)

    expect(isAppError(normalised)).toBe(true)
    expect(normalised.status).toBe(500)
    expect(normalised.code).toBe("INTERNAL")
    expect(normalised.message).toBe("Something went wrong")
    expect(normalised.message).not.toContain("connection string")
    expect(normalised.cause).toBe(cause)
  })

  it("TC-E0S0-06: returns an AppError unchanged", () => {
    const original = new ConflictError("Slot already booked")

    expect(toAppError(original)).toBe(original)
  })
})

describe("server action mapping", () => {
  it("TC-E0S0-07: maps a ZodError to VALIDATION with field errors", () => {
    const schema = z.object({
      email: z.email(),
      name: z.string().min(1),
    })

    const result = schema.safeParse({ email: "nope", name: "" })
    expect(result.success).toBe(false)

    const state = toActionState(
      result.success ? new Error("unreachable") : result.error
    )

    expect(state.status).toBe("error")
    expect(state.code).toBe("VALIDATION")
    expect(state.fieldErrors?.email).toEqual(["Invalid email address"])
    expect(state.fieldErrors?.name?.length).toBe(1)
  })

  it("TC-E0S0-08: runAction returns success data or a typed error state", async () => {
    const success = await runAction(async () => ({ id: "abc" }))
    expect(success).toEqual({ status: "success", data: { id: "abc" } })

    const failure = await runAction(async () => {
      throw new NotFoundError("Booking not found")
    })
    expect(failure).toEqual({
      status: "error",
      code: "NOT_FOUND",
      message: "Booking not found",
    })

    const unknown = await runAction(async () => {
      throw new Error("stripe key sk_live_leak")
    })
    expect(unknown).toEqual({
      status: "error",
      code: "INTERNAL",
      message: "Something went wrong",
    })
    expect(JSON.stringify(unknown)).not.toContain("sk_live")
  })

  it("TC-E0S0-08: toHttpResponse mirrors the error status", () => {
    expect(toHttpResponse(new ForbiddenError("Nope"))).toEqual({
      status: 403,
      body: {
        error: { code: "FORBIDDEN", message: "Nope" },
      },
    })

    const unknown = toHttpResponse(new Error("secret"))
    expect(unknown.status).toBe(500)
    expect(JSON.stringify(unknown)).not.toContain("secret")
  })
})

describe("Result", () => {
  it("TC-E0S0-09: helpers round-trip values and errors", () => {
    const success = ok(21)
    const failure = err(new NotFoundError("missing"))

    expect(isOk(success)).toBe(true)
    expect(isOk(failure)).toBe(false)
    expect(mapResult(success, (value) => value * 2)).toEqual(ok(42))
    expect(mapResult(failure, (value: number) => value * 2)).toEqual(failure)
    expect(unwrapOr(success, 0)).toBe(21)
    expect(unwrapOr(failure, 0)).toBe(0)
  })
})
