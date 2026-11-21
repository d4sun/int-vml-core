import { z } from "zod"

/**
 * Registration input shared by the client form and the server action.
 *
 * Keep these bounds in sync with the Better Auth config in E0-S1-02
 * (`emailAndPassword.minPasswordLength` / `maxPasswordLength`); the schema is
 * the server-side gate and must not be looser than the auth library.
 */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128
export const NAME_MAX_LENGTH = 100
export const EMAIL_MAX_LENGTH = 254

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `Password must be at most ${PASSWORD_MAX_LENGTH} characters`
  )
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number")

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH, `Email must be at most ${EMAIL_MAX_LENGTH} characters`)
  .pipe(z.email("Enter a valid email address"))

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name")
  .max(NAME_MAX_LENGTH, `Name must be at most ${NAME_MAX_LENGTH} characters`)

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
})

export type RegisterInput = z.infer<typeof registerSchema>

/**
 * Sign-in deliberately applies no password policy: existing credentials must
 * keep working if the policy tightens, and a policy message here would tell an
 * attacker what a valid password looks like. The upper bound still caps the
 * hashing work a single request can cause.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, "Enter your password")
    .max(
      PASSWORD_MAX_LENGTH,
      `Password must be at most ${PASSWORD_MAX_LENGTH} characters`
    ),
})

export type LoginInput = z.infer<typeof loginSchema>

export const forgotPasswordSchema = z.object({
  email: emailSchema,
})

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>

/** Field names match Better Auth's `/reset-password` body. */
export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, "This reset link is missing its token"),
  newPassword: passwordSchema,
})

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

/** The reset form: the same rules plus a typed-twice confirmation. */
export const resetPasswordFormSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })

/**
 * Editable profile fields. Strict on purpose: a payload carrying anything else
 * (notably `platformRole`, `email` or `emailVerified`) is rejected outright
 * instead of silently ignored, so tampering is visible and can never reach the
 * database through a spread.
 */
export const profileSchema = z.strictObject({
  name: nameSchema,
})

export type ProfileInput = z.infer<typeof profileSchema>
