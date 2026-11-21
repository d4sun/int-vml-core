"use client"

import { useState, type FormEvent } from "react"
import { TextField } from "@/components/auth/text-field"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { RESET_PASSWORD_PATH } from "@/lib/auth/password-reset"
import { forgotPasswordSchema } from "@/lib/validation/auth"
import { fieldErrors, type FieldErrors } from "@/lib/validation/form"

type State = "idle" | "sending" | "sent" | "throttled" | "error"

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [state, setState] = useState<State>("idle")
  const [sentTo, setSentTo] = useState("")

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsed = forgotPasswordSchema.safeParse({ email })

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }

    setErrors({})
    setState("sending")

    const { error } = await authClient.requestPasswordReset({
      email: parsed.data.email,
      redirectTo: RESET_PASSWORD_PATH,
    })

    if (!error) {
      setSentTo(parsed.data.email)
      setState("sent")
    } else if (error.status === 429) {
      setState("throttled")
    } else {
      setState("error")
    }
  }

  if (state === "sent") {
    return (
      <div role="status" aria-live="polite" className="space-y-3 text-sm">
        <p className="text-vml-ink">
          If an account exists for <strong>{sentTo}</strong>, we&apos;ve sent a
          link to reset its password. It is valid for one hour.
        </p>
        <p className="text-muted-foreground">
          Nothing arrived? Check your spam folder, or try again in a minute.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <TextField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={errors.email}
      />

      <div role="alert" className="text-sm font-medium text-destructive">
        {state === "throttled"
          ? "Too many requests. Please wait a minute and try again."
          : null}
        {state === "error"
          ? "We couldn't send that right now. Please try again shortly."
          : null}
      </div>

      <Button
        type="submit"
        className="h-10 w-full rounded-xl bg-vml-red text-white hover:bg-vml-red/90"
        disabled={state === "sending"}
      >
        {state === "sending" ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  )
}
