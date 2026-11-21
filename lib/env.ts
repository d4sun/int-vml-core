import { z } from "zod"

/**
 * Typed environment surface.
 *
 * Validation is deliberately pure and lazy:
 *
 * - `parseEnv(source)` never touches `process.env`, so tests can pass a fixture.
 * - `getEnv()` parses once and memoises; runtime entry points call it at boot.
 * - Nothing in this module validates provider-specific production rules (for
 *   example "production needs Brevo"). Those belong where the transport is
 *   constructed, because `next build` runs with `NODE_ENV=production` and must
 *   not require a live email provider.
 *
 * Server-only: do not import this from a client component.
 */

/**
 * `.env.example` uses `""` for optional variables. Treat blank values as unset
 * so copying the example file does not fail validation.
 */
function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value
}

const requiredUrl = z.string().trim().pipe(z.url())
const optionalUrl = z.preprocess(
  blankToUndefined,
  z.string().trim().pipe(z.url()).optional()
)
const optionalString = z.preprocess(
  blankToUndefined,
  z.string().trim().min(1).optional()
)
const optionalEmail = z.preprocess(
  blankToUndefined,
  z.string().trim().pipe(z.email()).optional()
)

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    // Prisma. The app runtime uses the pooled URL; migrations and pg-boss use
    // the direct/session URL.
    DATABASE_URL: requiredUrl,
    DIRECT_URL: requiredUrl,
    JOBS_DATABASE_URL: optionalUrl,
    TEST_DATABASE_URL: optionalUrl,

    // Transactional email. A provider key requires a verified sender address;
    // the transport itself is chosen in `lib/email/factory.ts`.
    BREVO_API_KEY: optionalString,
    EMAIL_FROM: optionalEmail,
    EMAIL_FROM_NAME: optionalString,
    EMAIL_OUTBOX_DIR: z.string().trim().min(1).default(".tmp/email-outbox"),

    // Better Auth. The secret is optional here because tests and local tooling
    // do not need it; the auth config tightens this rule where it is consumed.
    BETTER_AUTH_SECRET: optionalString,
    BETTER_AUTH_URL: z
      .string()
      .trim()
      .pipe(z.url())
      .default("http://localhost:3000"),
  })
  .superRefine((env, ctx) => {
    if (env.BREVO_API_KEY && !env.EMAIL_FROM) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_FROM"],
        message: "Required when BREVO_API_KEY is set",
      })
    }
  })

export type Env = z.infer<typeof envSchema>

/**
 * Parses and validates an environment source. Errors name every invalid field
 * but never echo its value, because several of these are secrets.
 */
export function parseEnv(
  source: Record<string, string | undefined> = process.env
): Env {
  const result = envSchema.safeParse(source)

  if (result.success) return result.data

  const details = result.error.issues.map((issue) => {
    const field = issue.path.join(".") || "environment"
    return `${field}: ${issue.message}`
  })

  throw new Error(
    `Invalid environment:\n${details.map((detail) => `  - ${detail}`).join("\n")}`
  )
}

let cached: Env | undefined

/** Memoised `parseEnv(process.env)` for runtime entry points. */
export function getEnv(): Env {
  cached ??= parseEnv()
  return cached
}
