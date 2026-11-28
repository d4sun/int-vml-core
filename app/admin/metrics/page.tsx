import type { Metadata } from "next"
import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { ValidationError } from "@/lib/errors"
import { formatPence } from "@/lib/money/format"
import { getMetrics, type MetricsSummary } from "@/lib/services/metrics"

export const metadata: Metadata = { title: "Metrics" }

const text = (value: string | string[] | undefined) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined

export default async function AdminMetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await enforceSurface("admin", "/admin/metrics")

  const params = await searchParams
  const range = { from: text(params.from), to: text(params.to) }

  let summary: MetricsSummary | null = null
  let error: string | null = null

  try {
    summary = await getMetrics(range)
  } catch (caught) {
    if (!(caught instanceof ValidationError)) throw caught
    const first = Object.values(caught.fieldErrors ?? {}).flat()[0]
    error = first ?? caught.message
  }

  const cards = summary
    ? [
        { label: "Gross merchandise value", value: formatPence(summary.gmv) },
        {
          label: "Commission (fee revenue)",
          value: formatPence(summary.feeRevenue),
        },
        { label: "Refunds confirmed", value: formatPence(summary.refunded) },
        { label: "Bookings", value: String(summary.bookings) },
        { label: "Places booked", value: String(summary.items) },
      ]
    : []

  return (
    <SurfaceShell eyebrow="Admin · Money" title="Metrics">
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4 text-sm"
      >
        <label className="space-y-1">
          <span className="block font-medium text-vml-ink">From (London)</span>
          <input
            type="date"
            name="from"
            defaultValue={range.from}
            className="rounded-lg border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-1">
          <span className="block font-medium text-vml-ink">To (London)</span>
          <input
            type="date"
            name="to"
            defaultValue={range.to}
            className="rounded-lg border border-input bg-background px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-xl bg-vml-navy px-4 py-2 font-semibold text-white"
        >
          Apply
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-6 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            {range.from && range.to
              ? `${range.from} to ${range.to}`
              : "All dates"}
            . Bookings count by the day they were made.
          </p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <li
                key={card.label}
                className="rounded-2xl border border-border bg-card p-5"
              >
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <p className="mt-1 text-2xl font-bold text-vml-ink">
                  {card.value}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </SurfaceShell>
  )
}
