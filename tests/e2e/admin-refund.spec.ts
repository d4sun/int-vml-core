import { randomUUID } from "node:crypto"
import { FakeStripe } from "../../lib/stripe/fake"
import { E2E_STRIPE_WEBHOOK_SECRET } from "../../playwright.config"
import {
  addBookingForTourist,
  createListingWithStatus,
  createVendorFor,
  latestBookingFor,
  paymentForBooking,
  refundForBooking,
  setVendorOnboarded,
} from "./db"
import {
  SEED,
  SEED_PASSWORD,
  createVerifiedUser,
  expect,
  signInAndWait,
  test,
} from "./support"

test("E2E-04: an admin refunds part of a booking; once Stripe confirms, the booking shows partly refunded", async ({
  page,
  request,
}) => {
  const vendorUser = await createVerifiedUser(request)
  const vendor = await createVendorFor(vendorUser.email, "APPROVED", {
    stripeAccountId: `acct_e2e_${randomUUID().slice(0, 8)}`,
  })
  await setVendorOnboarded(vendor.id)
  const title = `E2E Refund Walk ${randomUUID().slice(0, 8)}`
  const listing = await createListingWithStatus(vendor.id, title, "PUBLISHED")

  const tourist = await createVerifiedUser(request)
  await addBookingForTourist(listing.id, tourist.email)
  const booking = await latestBookingFor(tourist.email)
  await paymentForBooking(booking.id, 1500)

  await signInAndWait(page, SEED.admin, SEED_PASSWORD)
  await page.goto(`/admin/bookings/${booking.id}`)
  await page.getByLabel("Amount to refund (£)").fill("5.00")
  await page.getByRole("button", { name: "Issue refund" }).click()
  await expect(page.getByRole("status")).toContainText("Refund requested")

  // Stripe confirms the refund by webhook; the browser does not decide it (CR-4).
  const refundRow = await refundForBooking(booking.id)
  expect(refundRow.status).toBe("pending")
  expect(refundRow.stripeRefundId).toMatch(/^re_fake_/)

  const stripe = new FakeStripe({ webhookSecret: E2E_STRIPE_WEBHOOK_SECRET })
  const signed = stripe.signedEvent({
    id: `evt_e2e_refund_${randomUUID().slice(0, 8)}`,
    type: "refund.updated",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: refundRow.stripeRefundId,
        status: "succeeded",
        amount: refundRow.amount,
        metadata: { refundId: refundRow.id },
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

  await page.goto(`/admin/bookings/${booking.id}`)
  await expect(page.getByText("partially refunded")).toBeVisible()
  await expect(page.getByText("£5.00 · succeeded")).toBeVisible()
})
