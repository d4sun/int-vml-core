import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ExpiryCountdown } from "@/components/cart/expiry-countdown"
import { formatPence } from "@/lib/money/format"
import { UnauthenticatedError } from "@/lib/errors"
import { getCart } from "@/lib/services/cart"
import { removeCartItemFormAction, updateCartItemFormAction } from "./actions"
import { payCartAction } from "../checkout/actions"

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false, follow: false },
}

const when = (date: Date) =>
  date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  })

export default async function CartPage() {
  const cart = await getCart().catch((error: unknown) => {
    if (error instanceof UnauthenticatedError) redirect("/sign-in?next=/cart")
    throw error
  })

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-vml-ink">Your cart</h1>

      {cart.groups.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Your cart is empty.{" "}
          <Link
            href="/explore"
            className="font-medium text-vml-navy underline-offset-4 hover:underline"
          >
            Find something to book
          </Link>
          .
        </p>
      ) : (
        <>
          {cart.expiresAt ? (
            <div className="mt-4">
              <ExpiryCountdown expiresAt={cart.expiresAt.toISOString()} />
            </div>
          ) : null}

          {cart.groups.map((group) => (
            <section
              key={group.vendorId}
              aria-labelledby={`vendor-${group.vendorId}`}
              className="mt-8 rounded-2xl border border-border bg-card p-5"
            >
              <h2
                id={`vendor-${group.vendorId}`}
                className="text-lg font-bold text-vml-ink"
              >
                {group.vendorName}
              </h2>
              <ul className="mt-3 divide-y divide-border">
                {group.items.map((item) => (
                  <li
                    key={item.holdId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <Link
                        href={`/listings/${item.listingSlug}`}
                        className="font-semibold text-vml-ink hover:underline"
                      >
                        {item.listingTitle}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {item.productName} · {when(item.startAt)} ·{" "}
                        {formatPence(item.unitPrice)} each
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <form
                        action={updateCartItemFormAction}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="hidden"
                          name="holdId"
                          value={item.holdId}
                        />
                        <label
                          htmlFor={`qty-${item.holdId}`}
                          className="sr-only"
                        >
                          Places
                        </label>
                        <select
                          id={`qty-${item.holdId}`}
                          name="quantity"
                          defaultValue={item.quantity}
                          className="rounded-lg border border-input bg-background px-2 py-1 text-sm"
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="rounded-lg border border-border px-3 py-1 text-sm"
                        >
                          Update
                        </button>
                      </form>
                      <form action={removeCartItemFormAction}>
                        <input
                          type="hidden"
                          name="holdId"
                          value={item.holdId}
                        />
                        <button
                          type="submit"
                          className="rounded-lg border border-border px-3 py-1 text-sm"
                        >
                          Remove
                        </button>
                      </form>
                      <p className="w-24 text-right font-semibold text-vml-green">
                        {formatPence(item.lineTotal)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-right text-sm text-vml-ink">
                Subtotal{" "}
                <span className="font-semibold">
                  {formatPence(group.subtotal)}
                </span>
              </p>
            </section>
          ))}

          <p className="mt-8 text-right text-lg font-bold text-vml-ink">
            Total {formatPence(cart.total)}
          </p>
          <form action={payCartAction} className="mt-4 flex justify-end">
            {cart.groups
              .flatMap((group) => group.items)
              .map((item) => (
                <input
                  key={item.holdId}
                  type="hidden"
                  name="holdId"
                  value={item.holdId}
                />
              ))}
            <button
              type="submit"
              className="rounded-xl bg-vml-navy px-5 py-2 text-sm font-semibold text-white"
            >
              Continue to payment
            </button>
          </form>
          <p className="mt-2 text-right text-xs text-muted-foreground">
            You will pay on Stripe&apos;s secure page.
          </p>
        </>
      )}
    </main>
  )
}
