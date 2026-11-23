import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { SurfaceShell } from "@/components/surface-shell"
import { PayoutSetupForm } from "@/components/vendor/payout-setup-form"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { UnauthenticatedError } from "@/lib/errors"
import { getPayoutSetup, type PayoutSetup } from "@/lib/services/payout-setup"
import { startPayoutSetupAction } from "./actions"

export const metadata: Metadata = { title: "Payout setup" }

type SearchParams = Promise<{
  stripe?: string | string[]
  vendor?: string | string[]
}>

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

export default async function PayoutSetupPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await enforceSurface("vendor", "/vendor/payouts/setup")

  const query = await searchParams
  const vendorId = first(query.vendor)
  const setup = await getPayoutSetup(vendorId ? { vendorId } : {}).catch(
    (error: unknown) => {
      if (error instanceof UnauthenticatedError) {
        redirect("/sign-in?next=/vendor/payouts/setup")
      }

      throw error
    }
  )

  if (!setup) notFound()

  const returned = first(query.stripe)

  return (
    <SurfaceShell eyebrow="Vendor" title="Payout setup">
      <div className="max-w-xl space-y-5">
        <p className="text-sm text-muted-foreground">
          {setup.vendor.name}. Bookings are paid out through Stripe, so we need
          you to finish setting up your Stripe account before you can publish
          listings or receive money.
        </p>

        {returned === "refresh" ? (
          <p
            role="status"
            data-testid="payout-notice"
            className="rounded-xl border border-border bg-muted/40 p-3 text-sm"
          >
            That Stripe link expired or was already used. Start again below.
          </p>
        ) : null}

        <StatusCard setup={setup} justReturned={returned === "return"} />

        {setup.otherVendors.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Other vendors:{" "}
            {setup.otherVendors.map((v, i) => (
              <span key={v.id}>
                {i > 0 ? ", " : ""}
                <Link
                  className="underline"
                  href={`/vendor/payouts/setup?vendor=${v.id}`}
                >
                  {v.name}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </SurfaceShell>
  )
}

function StatusCard({
  setup,
  justReturned,
}: {
  setup: PayoutSetup
  justReturned: boolean
}) {
  const { state } = setup

  return (
    <section
      data-testid="payout-status"
      data-state={state}
      className="space-y-4 rounded-2xl border border-border p-5"
    >
      {state === "READY" ? (
        <>
          <h2 className="text-lg font-semibold text-vml-ink">
            Payouts are set up
          </h2>
          <p className="text-sm text-muted-foreground">
            Stripe has confirmed your account. You can publish listings and
            receive payouts.
          </p>
        </>
      ) : null}

      {state === "NOT_APPROVED" ? (
        <>
          <h2 className="text-lg font-semibold text-vml-ink">
            Not available yet
          </h2>
          <p className="text-sm text-muted-foreground">
            Payout setup opens once your vendor account has been approved. Your
            current status is{" "}
            <span className="font-medium">
              {setup.vendor.status.toLowerCase()}
            </span>
            .
          </p>
        </>
      ) : null}

      {state === "NOT_STARTED" ? (
        <>
          <h2 className="text-lg font-semibold text-vml-ink">Set up payouts</h2>
          <p className="text-sm text-muted-foreground">
            You&apos;ll be taken to Stripe to confirm your identity and add the
            bank account we pay into. It usually takes a few minutes.
          </p>
        </>
      ) : null}

      {state === "ACTION_NEEDED" ? (
        <>
          <h2 className="text-lg font-semibold text-vml-ink">Action needed</h2>
          {justReturned ? (
            <p className="text-sm text-muted-foreground">
              If you&apos;ve just finished, Stripe can take a minute to confirm.
              Refresh this page shortly.
            </p>
          ) : null}
          {setup.needs.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                Stripe still needs:
              </p>
              <ul
                data-testid="payout-needs"
                className="list-disc space-y-1 pl-5 text-sm text-vml-ink"
              >
                {setup.needs.map((need) => (
                  <li key={need}>{need}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Stripe is reviewing your details or needs a little more from you.
              Continue where you left off.
            </p>
          )}
        </>
      ) : null}

      {setup.canStart ? (
        <PayoutSetupForm
          action={startPayoutSetupAction}
          vendorId={setup.vendor.id}
          label={
            state === "NOT_STARTED" ? "Set up payouts" : "Continue onboarding"
          }
        />
      ) : null}

      {!setup.canStart &&
      setup.role !== "OWNER" &&
      setup.vendor.status === "APPROVED" &&
      state !== "READY" ? (
        <p
          data-testid="payout-owner-only"
          className="text-sm text-muted-foreground"
        >
          Only the account owner can set up payouts. Ask them to open this page.
        </p>
      ) : null}
    </section>
  )
}
