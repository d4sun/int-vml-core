import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { RefundForm } from "@/components/admin/refund-form"
import { RetryReversalForm } from "@/components/admin/retry-reversal-form"
import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { NotFoundError } from "@/lib/errors"
import { formatPence } from "@/lib/money/format"
import { getBookingForAdmin } from "@/lib/services/admin-bookings"
import { issueRefundAction, retryReversalAction } from "./actions"

export const metadata: Metadata = { title: "Booking" }

const when = (date: Date) =>
  date.toLocaleString("en-GB", { timeZone: "Europe/London" })

export default async function AdminBookingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  await enforceSurface("admin", `/admin/bookings/${id}`)

  const booking = await getBookingForAdmin(id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()

    throw error
  })

  const refundable = booking.items
    .filter((item) => item.refundable > 0)
    .map((item) => ({
      id: item.id,
      label: `${item.listingTitle}: ${item.productName} (${formatPence(item.refundable)} left)`,
      refundable: item.refundable,
    }))
  const canRefund =
    refundable.length > 0 &&
    (booking.status === "CONFIRMED" || booking.status === "PARTIALLY_REFUNDED")

  return (
    <SurfaceShell
      eyebrow="Admin · Bookings"
      title={`Booking ${booking.id.slice(0, 8).toUpperCase()}`}
    >
      <Link
        href="/admin"
        className="text-sm font-medium text-vml-navy underline-offset-4 hover:underline"
      >
        ← Admin home
      </Link>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section
            aria-labelledby="summary"
            className="rounded-2xl border border-border bg-card p-5"
          >
            <h2 id="summary" className="text-lg font-bold text-vml-ink">
              Summary
            </h2>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">
                  {booking.status.toLowerCase().replace("_", " ")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Total</dt>
                <dd className="font-medium">{formatPence(booking.total)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Visitor</dt>
                <dd className="font-medium">
                  {booking.tourist.name} ({booking.tourist.email})
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Booked</dt>
                <dd className="font-medium">{when(booking.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Payment</dt>
                <dd className="font-medium">
                  {booking.paymentStatus ?? "none"}
                </dd>
              </div>
            </dl>
          </section>

          <section
            aria-labelledby="items"
            className="rounded-2xl border border-border bg-card p-5"
          >
            <h2 id="items" className="text-lg font-bold text-vml-ink">
              Items
            </h2>
            <ul className="mt-4 divide-y divide-border text-sm">
              {booking.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap justify-between gap-2 py-3"
                >
                  <span>
                    {item.listingTitle}: {item.productName} · {item.vendorName}
                  </span>
                  <span>
                    {formatPence(item.subtotal)} · {item.status.toLowerCase()} ·{" "}
                    {formatPence(item.refundable)} refundable
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-labelledby="refunds"
            className="rounded-2xl border border-border bg-card p-5"
          >
            <h2 id="refunds" className="text-lg font-bold text-vml-ink">
              Refunds
            </h2>
            {booking.refunds.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No refunds yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border text-sm">
                {booking.refunds.map((refund) => (
                  <li
                    key={refund.id}
                    className="flex flex-wrap justify-between gap-2 py-3"
                  >
                    <span>
                      {when(refund.createdAt)}
                      {refund.reason ? ` · ${refund.reason}` : ""}
                    </span>
                    <span>
                      {formatPence(refund.amount)} · {refund.status}
                    </span>
                    {refund.flagged ? (
                      <div className="w-full space-y-2 rounded-lg bg-destructive/10 p-3">
                        <p className="font-medium text-destructive">
                          The visitor was refunded, but the vendor&apos;s
                          balance could not cover the reversal. Top up the
                          vendor&apos;s balance, then retry.
                        </p>
                        <RetryReversalForm
                          bookingId={booking.id}
                          refundId={refund.id}
                          action={retryReversalAction}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside
          aria-labelledby="refund-form"
          className="rounded-2xl border border-border bg-card p-5"
        >
          <h2 id="refund-form" className="text-lg font-bold text-vml-ink">
            Issue a refund
          </h2>
          {canRefund ? (
            <div className="mt-4">
              <RefundForm
                bookingId={booking.id}
                items={refundable}
                action={issueRefundAction}
              />
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Nothing is left to refund on this booking.
            </p>
          )}
        </aside>
      </div>
    </SurfaceShell>
  )
}
