"use client"

import Link from "next/link"
import { useState, type FormEvent } from "react"
import { TextField } from "@/components/auth/text-field"
import { Button, buttonVariants } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import {
  PASSWORD_MIN_LENGTH,
  resetPasswordFormSchema,
} from "@/lib/validation/auth"
import {
  fieldErrors,
  FORM_ERROR_KEY,
  type FieldErrors,
} from "@/lib/validation/form"

export function ResetPasswordForm({ token }: { token: string }) {
  const [values, setValues] = useState({ newPassword: "", confirmPassword: "" })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [linkDead, setLinkDead] = useState(false)

  const update =
    (field: "newPassword" | "confirmPassword") =>
    (event: { target: { value: string } }) =>
      setValues((current) => ({ ...current, [field]: event.target.value }))

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsed = resetPasswordFormSchema.safeParse(values)

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }

    setErrors({})
    setSubmitting(true)

    const { error } = await authClient.resetPassword({
      newPassword: parsed.data.newPassword,
      token,
    })

    setSubmitting(false)

    if (!error) {
      setDone(true)
    } else if (error.status === 400 && error.code === "INVALID_TOKEN") {
      setLinkDead(true)
    } else if (error.status === 400 && error.message) {
      setErrors({ [FORM_ERROR_KEY]: error.message })
    } else {
      setErrors({
        [FORM_ERROR_KEY]: "Something went wrong. Please try again.",
      })
    }
  }

  if (done) {
    return (
      <div role="status" aria-live="polite" className="space-y-4">
        <p className="text-sm text-vml-ink">
          Your password has been updated and you&apos;ve been signed out of
          other devices. You can sign in with it now.
        </p>
        <Link
          href="/sign-in"
          className={cn(
            buttonVariants(),
            "h-10 w-full rounded-xl bg-vml-red text-white hover:bg-vml-red/90"
          )}
        >
          Go to sign in
        </Link>
      </div>
    )
  }

  if (linkDead) {
    return (
      <div role="alert" className="space-y-4">
        <p className="text-sm text-vml-ink">
          This link has already been used or has expired. Request a new one to
          continue.
        </p>
        <Link
          href="/forgot-password"
          className={cn(buttonVariants({ variant: "outline" }), "h-10 w-full")}
        >
          Request a new link
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <TextField
        id="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        value={values.newPassword}
        onChange={update("newPassword")}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`}
        error={errors.newPassword}
      />
      <TextField
        id="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={values.confirmPassword}
        onChange={update("confirmPassword")}
        error={errors.confirmPassword}
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
        {submitting ? "Updating…" : "Update password"}
      </Button>
    </form>
  )
}
