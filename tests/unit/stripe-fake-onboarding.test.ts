import { describe, expect, it } from "vitest"
import { FakeStripe } from "@/lib/stripe/fake"
import {
  applyFakeOutcome,
  isSafeReturn,
  renderFakeOnboardingPage,
} from "@/lib/stripe/fake-onboarding"

const ORIGIN = "https://vml.test"
const RETURN = `${ORIGIN}/vendor/payouts/setup?stripe=return`

describe("isSafeReturn", () => {
  it("accepts only this app's payout setup page", () => {
    expect(isSafeReturn(RETURN, ORIGIN)).toBe(true)
    expect(isSafeReturn(`${ORIGIN}/vendor/payouts/setup`, ORIGIN)).toBe(true)
  })

  it.each([
    null,
    "",
    "not a url",
    "https://evil.test/vendor/payouts/setup",
    `${ORIGIN}/vendor`,
    `${ORIGIN}/vendor/payouts/setup/../../admin`,
    `${ORIGIN}.evil.test/vendor/payouts/setup`,
    "javascript:alert(1)",
    "//evil.test/vendor/payouts/setup",
  ])("rejects %j", (candidate) => {
    expect(isSafeReturn(candidate, ORIGIN)).toBe(false)
  })
})

describe("the fake hosted page", () => {
  it("links to the dev route with the account and both return urls", async () => {
    const fake = new FakeStripe()
    const { id } = await fake.createConnectAccount({ vendorId: "v1" })
    const link = await fake.createAccountLink({
      accountId: id,
      returnUrl: RETURN,
      refreshUrl: `${ORIGIN}/vendor/payouts/setup?stripe=refresh`,
    })
    const url = new URL(link.url)

    expect(url.origin).toBe(ORIGIN)
    expect(url.pathname).toBe("/api/dev/stripe-fake/onboard")
    expect(url.searchParams.get("account")).toBe(id)
    expect(url.searchParams.get("return")).toBe(RETURN)
  })

  it("escapes everything it prints", () => {
    const html = renderFakeOnboardingPage({
      account: `acct_"><script>alert(1)</script>`,
      returnUrl: `${ORIGIN}/x"><b>`,
      refreshUrl: "r&r",
    })

    expect(html).not.toContain("<script>")
    expect(html).not.toContain('"><b>')
    expect(html).toContain("r&amp;r")
    expect(html).toContain('value="complete"')
  })

  it("complete turns both capabilities on and returns a signed event for them", async () => {
    const fake = new FakeStripe()
    const { id } = await fake.createConnectAccount({ vendorId: "v1" })
    const event = applyFakeOutcome(fake, id, "complete")!

    expect(
      fake.constructWebhookEvent(event.rawBody, event.signature).data.object
    ).toMatchObject({ charges_enabled: true, payouts_enabled: true })
  })

  it("incomplete leaves payouts off with something still due", async () => {
    const fake = new FakeStripe()
    const { id } = await fake.createConnectAccount({ vendorId: "v1" })
    const event = applyFakeOutcome(fake, id, "incomplete")!

    expect(event.event.data.object).toMatchObject({
      charges_enabled: true,
      payouts_enabled: false,
      requirements: { currently_due: ["external_account"] },
    })
  })

  it("cancel changes nothing and sends no event", async () => {
    const fake = new FakeStripe()
    const { id } = await fake.createConnectAccount({ vendorId: "v1" })

    expect(applyFakeOutcome(fake, id, "cancel")).toBeNull()
    expect((await fake.retrieveConnectAccount(id)).chargesEnabled).toBe(false)
  })
})
