import { randomUUID } from "node:crypto"
import { FakeStripe } from "../../lib/stripe/fake"
import { E2E_STRIPE_WEBHOOK_SECRET } from "../../playwright.config"
import {
  addOpenSlot,
  createListingWithStatus,
  createVendorFor,
  latestBookingFor,
  moneyForBooking,
  setVendorOnboarded,
} from "./db"
import { createVerifiedUser, expect, signInAndWait, test } from "./support"

const unique = () => randomUUID().slice(0, 8)

/** A payable vendor with one published listing and one open time, seven days out. */
async function payableListing(
  request: Parameters<typeof createVerifiedUser>[0],
  remaining = 5
) {
  const owner = await createVerifiedUser(request)
  const vendor = await createVendorFor(owner.email, "APPROVED", {
    stripeAccountId: `acct_e2e_${unique()}`,
  })
  await setVendorOnboarded(vendor.id)
  const title = `E2E Flagship ${unique()}`
  const listing = await createListingWithStatus(vendor.id, title, "PUBLISHED")
  await addOpenSlot(
    listing.id,
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    remaining
  )

  return { listing, title }
}

test("E2E-02: a two-vendor cart is one payment, with a transfer planned for each vendor and the commission kept", async ({
  page,
  request,
}) => {
  const first = await payableListing(request)
  const second = await payableListing(request)

  const visitor = await createVerifiedUser(request)
  await signInAndWait(page, visitor.email, visitor.password)

  for (const { listing } of [first, second]) {
    await page.goto(`/listings/${listing.slug}`)
    await page.getByRole("button", { name: "Add to cart" }).click()
    await expect(page.getByRole("status")).toContainText("Added.")
  }

  await page.goto("/cart")
  await page.getByRole("button", { name: "Continue to payment" }).click()
  await page.getByRole("link", { name: "Pay £30.00" }).click()

  await expect(page.getByRole("status")).toContainText(
    "Your booking is confirmed"
  )

  const booking = await latestBookingFor(visitor.email)
  expect(booking.status).toBe("CONFIRMED")

  const money = await moneyForBooking(booking.id)
  expect(money.payments.map((p) => [p.status, p.amount])).toEqual([
    ["succeeded", 3000],
  ])
  // Two items, one per vendor, each keeping its commission (10% of £15.00).
  expect(money.items).toHaveLength(2)
  for (const item of money.items) {
    expect(item.commissionAmount).toBe(150)
    // The transfer is planned at confirmation; the settlement job may already have sent it.
    expect(item.transfers.map((t) => t.amount)).toEqual([1350])
    expect(["pending", "created"]).toContain(item.transfers[0]?.status)
  }
})

test("E2E-08: two visitors race for the last time; one holds it and the other finds no time left", async ({
  browser,
  request,
}) => {
  const { listing, title } = await payableListing(request, 1)

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  try {
    const a = await contextA.newPage()
    const b = await contextB.newPage()
    const tourists = [
      await createVerifiedUser(request),
      await createVerifiedUser(request),
    ]
    await signInAndWait(a, tourists[0]!.email, tourists[0]!.password)
    await signInAndWait(b, tourists[1]!.email, tourists[1]!.password)
    await a.goto(`/listings/${listing.slug}`)
    await b.goto(`/listings/${listing.slug}`)

    await Promise.all([
      a.getByRole("button", { name: "Add to cart" }).click(),
      b.getByRole("button", { name: "Add to cart" }).click(),
    ])

    // The place is gone from the listing once one visitor holds it, so the
    // outcome is read from the carts: exactly one holds the time, and the
    // other visitor's listing shows that no times are open.
    const inCart = async (p: typeof a, title: string) => {
      await p.goto("/cart")
      return p.getByRole("link", { name: title }).count()
    }
    // Both clicks have finished once exactly one cart holds the time.
    let aHolds = 0
    let bHolds = 0
    await expect
      .poll(async () => {
        aHolds = await inCart(a, title)
        bHolds = await inCart(b, title)

        return aHolds + bHolds
      })
      .toBe(1)

    const loser = aHolds === 0 ? a : b
    await loser.goto(`/listings/${listing.slug}`)
    await expect(
      loser.getByText("No times are open to book right now.")
    ).toBeVisible()
  } finally {
    await contextA.close()
    await contextB.close()
  }
})

test("E2E-09: the booking confirms from the webhook alone, with the browser never returning to the site", async ({
  page,
  request,
}) => {
  const { listing } = await payableListing(request)

  const visitor = await createVerifiedUser(request)
  await signInAndWait(page, visitor.email, visitor.password)

  await page.goto(`/listings/${listing.slug}`)
  await page.getByRole("button", { name: "Add to cart" }).click()
  await expect(page.getByRole("status")).toContainText("Added.")

  await page.goto("/cart")
  await page.getByRole("button", { name: "Continue to payment" }).click()
  // The visitor is now on the Stripe page. They never click Pay: the redirect is dropped.
  await expect(page.getByRole("link", { name: "Pay £15.00" })).toBeVisible()

  const booking = await latestBookingFor(visitor.email)
  const stripe = new FakeStripe({ webhookSecret: E2E_STRIPE_WEBHOOK_SECRET })
  const signed = stripe.signedEvent({
    id: `evt_e2e_${unique()}`,
    type: "payment_intent.succeeded",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `pi_e2e_${unique()}`,
        amount: 1500,
        metadata: { bookingId: booking.id },
      },
    },
  })

  const delivered = await request.post("/api/webhooks/stripe", {
    data: signed.rawBody,
    headers: {
      "content-type": "application/json",
      "stripe-signature": signed.signature,
    },
  })
  expect(delivered.status(), await delivered.text()).toBe(200)

  // The processing page only reads the state; the webhook made it CONFIRMED.
  await page.goto(`/checkout/processing?booking=${booking.id}`)
  await expect(page.getByRole("status")).toContainText(
    "Your booking is confirmed"
  )
  expect((await latestBookingFor(visitor.email)).status).toBe("CONFIRMED")
})
