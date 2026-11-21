import type { PrismaClient } from "@prisma/client"
import { betterAuth, type BetterAuthOptions } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { createAuthEmailSenders } from "@/lib/email/auth-senders"
import type { EmailQueue } from "@/lib/email/queue"
import { VERIFICATION_CALLBACK_PATH } from "@/lib/auth/verification"
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
  registerSchema,
} from "@/lib/validation/auth"

export const VERIFICATION_TOKEN_TTL_SECONDS = 60 * 60
export const RESET_TOKEN_TTL_SECONDS = 60 * 60
export const MIN_SECRET_LENGTH = 32

/**
 * Per client IP, per path, in a rolling window (CR-8). Stored in Postgres
 * (`RateLimit`), so there is no Redis dependency and limits survive restarts.
 * These replace Better Auth's built-in 3 requests / 10 s sign-up rule.
 */
export const AUTH_RATE_LIMITS = {
  signUp: { path: "/sign-up/email", window: 60, max: 5 },
  resendVerification: { path: "/send-verification-email", window: 60, max: 3 },
} as const

export type AuthDeps = {
  /** Better Auth database adapter; see `prismaAuthDatabase` for production. */
  database: NonNullable<BetterAuthOptions["database"]>
  emailQueue: EmailQueue
  /** Public origin; used for cookies, email links and trusted origins. */
  baseURL: string
  secret: string
  replyTo?: string
}

/**
 * Better Auth needs a strong secret everywhere (including dev, where its
 * built-in fallback is public). `lib/env.ts` keeps the variable optional so
 * tooling and unit tests do not need it; this is where it becomes mandatory.
 */
export function requireAuthSecret(secret: string | undefined): string {
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters (generate one with \`pnpm dlx auth@latest secret\`)`
    )
  }

  return secret
}

export function prismaAuthDatabase(prisma: PrismaClient) {
  return prismaAdapter(prisma, { provider: "postgresql" })
}

function validationError(message: string): APIError {
  return new APIError("BAD_REQUEST", { message, code: "VALIDATION_ERROR" })
}

/**
 * Builds the Better Auth instance from explicit dependencies so tests can
 * inject a database adapter and an in-memory queue. Production wiring
 * lives in `lib/auth.ts`.
 */
export function createAuth(deps: AuthDeps) {
  const senders = createAuthEmailSenders(deps.emailQueue, {
    ...(deps.replyTo ? { replyTo: deps.replyTo } : {}),
  })

  return betterAuth({
    appName: "VisitMyLondon",
    baseURL: deps.baseURL,
    secret: requireAuthSecret(deps.secret),
    trustedOrigins: [deps.baseURL],
    database: deps.database,

    user: {
      additionalFields: {
        // Server-assigned only (CR-1): `input: false` makes Better Auth drop
        // any client-supplied value on sign-up and profile update.
        platformRole: {
          type: "string",
          required: false,
          defaultValue: "TOURIST",
          input: false,
        },
      },
    },

    rateLimit: {
      // Off by default outside production; the limits must hold everywhere.
      enabled: true,
      storage: "database",
      customRules: {
        [AUTH_RATE_LIMITS.signUp.path]: {
          window: AUTH_RATE_LIMITS.signUp.window,
          max: AUTH_RATE_LIMITS.signUp.max,
        },
        [AUTH_RATE_LIMITS.resendVerification.path]: {
          window: AUTH_RATE_LIMITS.resendVerification.window,
          max: AUTH_RATE_LIMITS.resendVerification.max,
        },
      },
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: senders.sendResetPassword,
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: VERIFICATION_TOKEN_TTL_SECONDS,
      sendVerificationEmail: senders.sendVerificationEmail,
    },

    hooks: {
      // The shared zod schemas are the server-side gate (the password policy
      // is stricter than Better Auth's length-only check) and normalise input
      // before Better Auth sees it.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          const parsed = registerSchema.safeParse(ctx.body)

          if (!parsed.success) {
            throw validationError(
              parsed.error.issues[0]?.message ?? "Invalid registration details"
            )
          }

          return {
            context: {
              ...ctx,
              body: {
                ...ctx.body,
                ...parsed.data,
                callbackURL: VERIFICATION_CALLBACK_PATH,
              },
            },
          }
        }

        // Verification links always land on one page, never on a client- or
        // link-supplied destination.
        if (ctx.path === "/send-verification-email") {
          return {
            context: {
              ...ctx,
              body: { ...ctx.body, callbackURL: VERIFICATION_CALLBACK_PATH },
            },
          }
        }

        if (ctx.path === "/verify-email") {
          return {
            context: {
              ...ctx,
              query: { ...ctx.query, callbackURL: VERIFICATION_CALLBACK_PATH },
            },
          }
        }

        if (ctx.path === "/reset-password" || ctx.path === "/change-password") {
          const parsed = passwordSchema.safeParse(ctx.body?.newPassword)

          if (!parsed.success) {
            throw validationError(
              parsed.error.issues[0]?.message ?? "Invalid password"
            )
          }
        }
      }),
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
