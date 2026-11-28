import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { formatPence } from "@/lib/money/format"
import { getVendorContext } from "@/lib/services/listing"
import { getVendorEarnings } from "@/lib/services/vendor-earnings"

export const metadata: Metadata = { title: "Earnings" }

export default async function VendorEarningsPage() {
  await enforceSurface("vendor", "/vendor/earnings")

  const context = await getVendorContext()

  if (!context) notFound()

  const earnings = await getVendorEarnings({ vendorId: context.vendor.id })

  return (
    <SurfaceShell eyebrow="Vendor" title="Earnings">
      <p className="text-sm text-muted-foreground">
        Gross is what your paid sales came to. Net is gross, less VML&apos;s
        commission, less refunds. Months are London months.
      </p>

      <section
        aria-labelledby="totals"
        className="mt-6 rounded-2xl border border-border bg-card p-5"
      >
        <h2 id="totals" className="text-lg font-bold text-vml-ink">
          All time
        </h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Gross</dt>
            <dd className="text-lg font-bold">
              {formatPence(earnings.totals.gross)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Commission</dt>
            <dd className="text-lg font-bold">
              {formatPence(earnings.totals.commission)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Refunds</dt>
            <dd className="text-lg font-bold">
              {formatPence(earnings.totals.refunds)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Net</dt>
            <dd className="text-lg font-bold">
              {formatPence(earnings.totals.net)}
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="months"
        className="mt-6 rounded-2xl border border-border bg-card p-5"
      >
        <h2 id="months" className="text-lg font-bold text-vml-ink">
          By month
        </h2>
        {earnings.periods.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No paid sales yet.
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1">Month</th>
                <th className="text-right">Gross</th>
                <th className="text-right">Commission</th>
                <th className="text-right">Refunds</th>
                <th className="text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {earnings.periods.map((row) => (
                <tr key={row.period} className="border-t border-border">
                  <td className="py-2">{row.period}</td>
                  <td className="text-right">{formatPence(row.gross)}</td>
                  <td className="text-right">{formatPence(row.commission)}</td>
                  <td className="text-right">{formatPence(row.refunds)}</td>
                  <td className="text-right font-semibold">
                    {formatPence(row.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </SurfaceShell>
  )
}
