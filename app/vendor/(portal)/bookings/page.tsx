import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SurfaceShell } from "@/components/surface-shell"
import { Button } from "@/components/ui/button"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { formatPence } from "@/lib/money/format"
import { getVendorContext } from "@/lib/services/listing"
import { listVendorBookings } from "@/lib/services/vendor-bookings"
import { fulfilBookingItemAction, noShowBookingItemAction } from "./actions"

export const metadata: Metadata = { title: "Bookings" }

const LABEL: Record<string, string> = {
  CONFIRMED: "Confirmed",
  FULFILLED: "Fulfilled",
  NO_SHOW: "No-show",
  REFUNDED: "Refunded",
  CANCELLED: "Cancelled",
}

const when = (date: Date) =>
  date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  })

export default async function VendorBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>
}) {
  await enforceSurface("vendor", "/vendor/bookings")

  const { date, error } = await searchParams
  const context = await getVendorContext()

  if (!context) notFound()

  const approved = context.vendor.status === "APPROVED"
  const items = approved
    ? await listVendorBookings({
        vendorId: context.vendor.id,
        date: date || undefined,
      })
    : []

  return (
    <SurfaceShell eyebrow="Vendor" title="Bookings">
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">{context.vendor.name}</p>

        {!approved ? (
          <p className="text-sm">
            Bookings appear here once your vendor account has been approved.
          </p>
        ) : (
          <>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <label
                htmlFor="booking-date"
                className="text-sm font-medium text-vml-ink"
              >
                Day
              </label>
              <input
                id="booking-date"
                name="date"
                type="date"
                defaultValue={date ?? ""}
                className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
              />
              <Button type="submit" variant="outline" size="sm">
                Show
              </Button>
            </form>

            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}

            {items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No bookings{date ? " on this day" : " yet"}.
              </p>
            ) : (
              <ul
                className="divide-y divide-border rounded-2xl border border-border bg-card"
                aria-label="Bookings"
              >
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-4"
                    data-status={item.status}
                  >
                    <div>
                      <p className="font-semibold text-vml-ink">
                        {item.listingTitle}: {item.productName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {when(item.startAt)} · {item.quantity}{" "}
                        {item.quantity === 1 ? "place" : "places"} ·{" "}
                        {formatPence(item.subtotal)} · ref {item.bookingRef}
                      </p>
                      <p className="text-sm font-medium text-vml-ink">
                        {LABEL[item.status] ?? item.status}
                      </p>
                    </div>
                    {item.status === "CONFIRMED" ? (
                      <div className="flex gap-2">
                        <form action={fulfilBookingItemAction}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <Button type="submit" size="sm">
                            Mark fulfilled
                          </Button>
                        </form>
                        <form action={noShowBookingItemAction}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <Button type="submit" size="sm" variant="outline">
                            Mark no-show
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </SurfaceShell>
  )
}
