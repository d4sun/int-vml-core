import { PAYOUT_SETUP_PATH } from "@/lib/services/vendor-onboarding"
import type { FakeStripe } from "./fake"

export type FakeOnboardingOutcome = "complete" | "incomplete" | "cancel"

export const FAKE_ONBOARDING_OUTCOMES: readonly FakeOnboardingOutcome[] = [
  "complete",
  "incomplete",
  "cancel",
]

/**
 * Where the fake's page may send the visitor back to: this app's payout setup
 * page and nothing else, so the dev page can never be used as an open
 * redirect.
 */
export function isSafeReturn(candidate: string | null, origin: string) {
  if (!candidate) return false

  try {
    const url = new URL(candidate)

    return url.origin === origin && url.pathname === PAYOUT_SETUP_PATH
  } catch {
    return false
  }
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string
  )

/** A stand-in for Stripe's hosted onboarding page. Development only. */
export function renderFakeOnboardingPage(params: {
  account: string
  returnUrl: string
  refreshUrl: string
}): string {
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`
  const button = (outcome: FakeOnboardingOutcome, label: string) =>
    `<button type="submit" name="outcome" value="${outcome}">${label}</button>`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fake Stripe onboarding</title>
<meta name="robots" content="noindex"></head>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1>Fake Stripe onboarding</h1>
<p>This stands in for Stripe's hosted page. It exists only while no Stripe key is configured.</p>
<p>Account <code>${escapeHtml(params.account)}</code></p>
<form method="post" style="display:grid;gap:.75rem">
${hidden("account", params.account)}
${hidden("return", params.returnUrl)}
${hidden("refresh", params.refreshUrl)}
${button("complete", "Complete onboarding")}
${button("incomplete", "Submit but leave something outstanding")}
${button("cancel", "Leave without finishing")}
</form></body></html>`
}

/**
 * Applies what the owner "did" on the fake page to the fake account and
 * returns the signed `account.updated` event Stripe would then send.
 */
export function applyFakeOutcome(
  fake: FakeStripe,
  accountId: string,
  outcome: FakeOnboardingOutcome
) {
  if (outcome === "complete") {
    fake.completeOnboarding(accountId)
  } else if (outcome === "incomplete") {
    fake.setAccount(accountId, {
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
      currentlyDue: ["external_account"],
      disabledReason: "requirements.pending_verification",
    })
  } else {
    return null
  }

  return fake.signedAccountUpdated(accountId)
}
