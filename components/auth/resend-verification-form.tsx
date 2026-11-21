"use client"

import { useEffect, useState, type FormEvent } from "react"
import { TextField } from "@/components/auth/text-field"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { VERIFICATION_CALLBACK_PATH } from "@/lib/auth/verification"
import { emailSchema } from "@/lib/validation/auth"

const COOLDOWN_SECONDS = 30

type State = "idle" | "sending" | "sent" | "throttled" | "error"

/**
 * Asks for a fresh verification link. The server answers identically for
 * unknown, verified and unverified addresses, so the confirmation copy is
 * deliberately neutral (CR-9).
 */
export function ResendVerificationForm({
  email: knownEmail,
}: {
  /** When the address is already known (right after sign-up) skip the input. */
  email?: string
}) {
  const [email, setEmail] = useState(knownEmail ?? "")
  const [fieldError, setFieldError] = useState<string>()
  const [state, setState] = useState<State>("idle")
  const [cooldown, setCooldown] = useState(0)

  const counting = cooldown > 0

  useEffect(() => {
    if (!counting) return

    const timer = setInterval(() => {
      setCooldown((seconds) => Math.max(0, seconds - 1))
    }, 1000)

    return () => clearInterval(timer)
  }, [counting])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsed = emailSchema.safeParse(email)

    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message)
      return
    }

    setFieldError(undefined)
    setState("sending")

    const { error } = await authClient.sendVerificationEmail({
      email: parsed.data,
      callbackURL: VERIFICATION_CALLBACK_PATH,
    })

    if (!error) {
      setState("sent")
      setCooldown(COOLDOWN_SECONDS)
    } else if (error.status === 429) {
      setState("throttled")
    } else {
      setState("error")
    }
  }

  const busy = state === "sending" || cooldown > 0

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {knownEmail ? null : (
        <TextField
          id="resend-email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError}
        />
      )}

      <Button
        type="submit"
        variant="outline"
        className="h-10 w-full rounded-xl"
        disabled={busy}
      >
        {state === "sending"
          ? "Sending…"
          : cooldown > 0
            ? `Resend available in ${cooldown}s`
            : "Resend verification email"}
      </Button>

      <div role="status" aria-live="polite" className="text-sm">
        {state === "sent" ? (
          <p className="text-muted-foreground">
            If that address has an unverified account, a new link is on its way.
            It is valid for one hour.
          </p>
        ) : null}
        {state === "throttled" ? (
          <p className="font-medium text-destructive">
            Too many requests. Please wait a minute and try again.
          </p>
        ) : null}
        {state === "error" ? (
          <p className="font-medium text-destructive">
            We couldn&apos;t send that right now. Please try again shortly.
          </p>
        ) : null}
      </div>
    </form>
  )
}
