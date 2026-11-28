import type { Metadata } from "next"
import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { formatPence } from "@/lib/money/format"
import { listDisputes } from "@/lib/services/disputes"

export const metadata: Metadata = { title: "Disputes" }

const when = (date: Date) =>
  date.toLocaleString("en-GB", { timeZone: "Europe/London" })

export default async function AdminDisputesPage() {
  await enforceSurface("admin", "/admin/disputes")

  const disputes = await listDisputes()

  return (
    <SurfaceShell eyebrow="Admin · Money" title="Disputes">
      <p className="text-sm text-muted-foreground">
        Chargebacks opened by visitors&apos; banks. They are recorded here for
        review; they are settled in Stripe.
      </p>

      <section
        aria-labelledby="list"
        className="mt-6 rounded-2xl border border-border bg-card p-5"
      >
        <h2 id="list" className="text-lg font-bold text-vml-ink">
          Recorded disputes
        </h2>
        {disputes.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No disputes recorded.
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1">Opened</th>
                <th>Booking</th>
                <th>Reason</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {disputes.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="py-2">{when(d.createdAt)}</td>
                  <td>{d.bookingId.slice(0, 8).toUpperCase()}</td>
                  <td>{d.reason ?? "—"}</td>
                  <td>{d.status}</td>
                  <td className="text-right">{formatPence(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </SurfaceShell>
  )
}
