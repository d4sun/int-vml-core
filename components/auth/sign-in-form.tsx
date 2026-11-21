"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { ResendVerificationForm } from "@/components/auth/resend-verification-form"
import { TextField } from "@/components/auth/text-field"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { loginSchema } from "@/lib/validation/auth"
import {
  fieldErrors,
  FORM_ERROR_KEY,
  type FieldErrors,
} from "@/lib/validation/form"

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter()
  const [values, setValues] = useState({ email: "", password: "" })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [unverifiedEmail, setUnverifiedEmail] = useState<string>()

  const update =
    (field: "email" | "password") => (event: { target: { value: string } }) =>
      setValues((current) => ({ ...current, [field]: event.target.value }))

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsed = loginSchema.safeParse(values)

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }

    setErrors({})
    setUnverifiedEmail(undefined)
    setSubmitting(true)

    const { error } = await authClient.signIn.email(parsed.data)

    setSubmitting(false)

    if (!error) {
      router.push(redirectTo)
      router.refresh()
      return
    }

    // The same wording for a wrong password and an unknown address (CR-9).
    if (error.status === 401) {
      setErrors({ [FORM_ERROR_KEY]: "Incorrect email or password." })
    } else if (error.status === 403) {
      setUnverifiedEmail(parsed.data.email)
    } else if (error.status === 429) {
      setErrors({
        [FORM_ERROR_KEY]:
          "Too many attempts. Please wait a few minutes and try again.",
      })
    } else {
      setErrors({
        [FORM_ERROR_KEY]: "Something went wrong. Please try again.",
      })
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
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
          autoComplete="current-password"
          value={values.password}
          onChange={update("password")}
          error={errors.password}
        />

        <div className="text-right text-sm">
          <Link
            href="/forgot-password"
            className="font-medium text-vml-navy underline"
          >
            Forgot your password?
          </Link>
        </div>

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
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {unverifiedEmail ? (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-border bg-muted/40 p-4"
        >
          <p className="text-sm text-vml-ink">
            Your email address hasn&apos;t been verified yet. Open the link we
            sent you, or ask for a new one.
          </p>
          <ResendVerificationForm email={unverifiedEmail} />
        </div>
      ) : null}
    </div>
  )
}
