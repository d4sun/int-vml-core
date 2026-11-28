import type { Metadata } from "next"
import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { ValidationError } from "@/lib/errors"
import { formatPence } from "@/lib/money/format"
import { getLedger, type LedgerKind } from "@/lib/services/ledger"

export const metadata: Metadata = { title: "Ledger" }

const KIND_LABEL: Record<LedgerKind, string> = {
  payment: "Payment",
  transfer: "Transfer",
  refund: "Refund",
}

const when = (date: Date) =>
  date.toLocaleString("en-GB", { timeZone: "Europe/London" })

const text = (value: string | string[] | undefined) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined

export default async function AdminLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await enforceSurface("admin", "/admin/ledger")

  const params = await searchParams
  const filter = {
    kind: text(params.kind) ?? "all",
    from: text(params.from),
    to: text(params.to),
  }

  let ledger: Awaited<ReturnType<typeof getLedger>> | null = null
  let error: string | null = null

  try {
    ledger = await getLedger(filter)
  } catch (caught) {
    if (!(caught instanceof ValidationError)) throw caught
    const first = Object.values(caught.fieldErrors ?? {}).flat()[0]
    error = first ?? caught.message
  }

  return (
    <SurfaceShell eyebrow="Admin · Money" title="Ledger">
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4 text-sm"
      >
        <label className="space-y-1">
          <span className="block font-medium text-vml-ink">Kind</span>
          <select
            name="kind"
            defaultValue={filter.kind}
            className="rounded-lg border border-input bg-background px-3 py-2"
          >
            <option value="all">All</option>
            <option value="payment">Payments</option>
            <option value="transfer">Transfers</option>
            <option value="refund">Refunds</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block font-medium text-vml-ink">From (London)</span>
          <input
            type="date"
            name="from"
            defaultValue={filter.from}
            className="rounded-lg border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-1">
          <span className="block font-medium text-vml-ink">To (London)</span>
          <input
            type="date"
            name="to"
            defaultValue={filter.to}
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
      ) : ledger ? (
        <>
          <section
            aria-labelledby="totals"
            className="mt-6 rounded-2xl border border-border bg-card p-5"
          >
            <h2 id="totals" className="text-lg font-bold text-vml-ink">
              Totals
            </h2>
            {ledger.totals.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Nothing in this range.
              </p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1">Kind</th>
                    <th>Status</th>
                    <th className="text-right">Count</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.totals.map((t) => (
                    <tr
                      key={`${t.kind}-${t.status}`}
                      className="border-t border-border"
                    >
                      <td className="py-2">{KIND_LABEL[t.kind]}</td>
                      <td>{t.status}</td>
                      <td className="text-right">{t.count}</td>
                      <td className="text-right">{formatPence(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section
            aria-labelledby="rows"
            className="mt-6 rounded-2xl border border-border bg-card p-5"
          >
            <h2 id="rows" className="text-lg font-bold text-vml-ink">
              Movements
            </h2>
            {ledger.rows.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No movements match.
              </p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1">When</th>
                    <th>Kind</th>
                    <th>Booking</th>
                    <th>Vendor</th>
                    <th>Status</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.rows.map((row) => (
                    <tr
                      key={`${row.kind}-${row.id}`}
                      className="border-t border-border"
                    >
                      <td className="py-2">{when(row.at)}</td>
                      <td>{KIND_LABEL[row.kind]}</td>
                      <td>{row.bookingId.slice(0, 8).toUpperCase()}</td>
                      <td>{row.vendorName ?? "—"}</td>
                      <td>
                        {row.status}
                        {row.note ? ` (${row.note})` : ""}
                      </td>
                      <td className="text-right">{formatPence(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {ledger.truncated ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Only the newest 200 movements are shown. Narrow the dates to see
                the rest.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </SurfaceShell>
  )
}
