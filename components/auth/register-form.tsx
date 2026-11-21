"use client"

import { useState, type FormEvent } from "react"
import { ResendVerificationForm } from "@/components/auth/resend-verification-form"
import { TextField } from "@/components/auth/text-field"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { VERIFICATION_CALLBACK_PATH } from "@/lib/auth/verification"
import { PASSWORD_MIN_LENGTH, registerSchema } from "@/lib/validation/auth"
import {
  fieldErrors,
  FORM_ERROR_KEY,
  type FieldErrors,
} from "@/lib/validation/form"

type Values = { name: string; email: string; password: string }

export function RegisterForm() {
  const [values, setValues] = useState<Values>({
    name: "",
    email: "",
    password: "",
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState<string>()

  const update =
    (field: keyof Values) => (event: { target: { value: string } }) =>
      setValues((current) => ({ ...current, [field]: event.target.value }))

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsed = registerSchema.safeParse(values)

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }

    setErrors({})
    setSubmitting(true)

    const { error } = await authClient.signUp.email({
      ...parsed.data,
      callbackURL: VERIFICATION_CALLBACK_PATH,
    })

    setSubmitting(false)

    if (!error) {
      // Same screen whether the address was new or already registered (CR-9).
      setSubmittedEmail(parsed.data.email)
      return
    }

    if (error.status === 429) {
      setErrors({
        [FORM_ERROR_KEY]:
          "Too many attempts. Please wait a minute and try again.",
      })
    } else if (error.status === 400 && error.message) {
      setErrors({ [FORM_ERROR_KEY]: error.message })
    } else {
      setErrors({
        [FORM_ERROR_KEY]: "Something went wrong. Please try again.",
      })
    }
  }

  if (submittedEmail) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <p className="text-sm text-vml-ink">
          If <strong>{submittedEmail}</strong> can be registered, we&apos;ve
          sent a confirmation link to that address. Open it within one hour to
          finish setting up your account.
        </p>
        <p className="text-sm text-muted-foreground">
          Nothing arrived? Check your spam folder, or ask for another link.
        </p>
        <ResendVerificationForm email={submittedEmail} />
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <TextField
        id="name"
        label="Full name"
        autoComplete="name"
        value={values.name}
        onChange={update("name")}
        error={errors.name}
      />
      <TextField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={values.email}
        onChange={update("email")}
        error={errors.email}
      />
      <TextField
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        value={values.password}
        onChange={update("password")}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`}
        error={errors.password}
      />

      {errors[FORM_ERROR_KEY] ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errors[FORM_ERROR_KEY]}
        </p>
      ) : null}

      <Button
        type="submit"
        className="h-10 w-full rounded-xl bg-vml-red text-white hover:bg-vml-red/90"
        disabled={submitting}
      >
        {submitting ? "Creating account…" : "Create account"}
      </Button>
    </form>
  )
}
