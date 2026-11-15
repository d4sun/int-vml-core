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
