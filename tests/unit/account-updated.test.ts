import { describe, expect, it } from "vitest"
import type { StripeWebhookEvent } from "@/lib/stripe/adapter"
import {
  PAYOUTS_DISABLED_ACTION,
  PAYOUTS_ENABLED_ACTION,
  handleAccountUpdated,
  summariseAccount,
} from "@/lib/webhooks/account-updated"
import { stripeHandlers } from "@/lib/webhooks/handlers"

const account = (overrides: Record<string, unknown> = {}) => ({
  id: "acct_1",
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  requirements: { currently_due: [], past_due: [], disabled_reason: null },
  ...overrides,
})

describe("summariseAccount", () => {
  it("TC-E4S2-01: charges and payouts both enabled means payout ready", () => {
    expect(summariseAccount(account())).toEqual({
      accountId: "acct_1",
      onboardingComplete: true,
      requirementsDue: [],
      disabledReason: null,
    })
  })

  it("TC-E4S2-03: charges without payouts is not ready", () => {
    expect(
      summariseAccount(account({ payouts_enabled: false })).onboardingComplete
    ).toBe(false)
  })

  it("TC-E4S2-03: payouts without charges is not ready", () => {
    expect(
      summariseAccount(account({ charges_enabled: false })).onboardingComplete
    ).toBe(false)
  })

  it("TC-E4S2-03: submitted details do not make an account ready", () => {
    expect(
      summariseAccount(
        account({
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: true,
        })
      ).onboardingComplete
    ).toBe(false)
  })

  it("merges currently due and past due without repeats, keeping Stripe's order", () => {
    const summary = summariseAccount(
      account({
        charges_enabled: false,
        requirements: {
          currently_due: ["external_account", "individual.dob"],
          past_due: ["individual.dob", "tos_acceptance.date"],
          disabled_reason: "requirements.past_due",
        },
      })
    )

    expect(summary.requirementsDue).toEqual([
      "external_account",
      "individual.dob",
      "tos_acceptance.date",
    ])
    expect(summary.disabledReason).toBe("requirements.past_due")
  })

  it("accepts missing, null and empty requirement data", () => {
    for (const requirements of [
      undefined,
      null,
      {},
      { currently_due: null, past_due: null },
    ]) {
      expect(summariseAccount(account({ requirements }))).toMatchObject({
        requirementsDue: [],
        disabledReason: null,
      })
    }
  })

  it("caps how much one event can store", () => {
    const many = Array.from({ length: 500 }, (_, i) => `field_${i}`)
    const summary = summariseAccount(
      account({
        requirements: {
          currently_due: many,
          disabled_reason: "x".repeat(1000),
        },
      })
    )

    expect(summary.requirementsDue).toHaveLength(100)
    expect(summary.disabledReason).toHaveLength(200)
    expect(
      summariseAccount(
        account({ requirements: { currently_due: ["y".repeat(900)] } })
      ).requirementsDue[0]
    ).toHaveLength(200)
  })

  it.each([
    ["no id", { id: undefined }],
    ["a non-boolean capability", { charges_enabled: "yes" }],
    ["a missing capability", { payouts_enabled: undefined }],
    ["a string requirement list", { requirements: { currently_due: "x" } }],
  ])("rejects a payload with %s instead of guessing", (_, overrides) => {
    expect(() => summariseAccount(account(overrides))).toThrow()
  })
})

type Row = {
  id: string
  stripeOnboardingComplete: boolean
  stripeStatusAt: Date | null
}

function setup(row: Row | null) {
  const log: string[] = []
  const updates: unknown[] = []
  const audits: unknown[] = []
  let sql = ""
  let values: unknown[] = []

  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...rest: unknown[]) => {
      log.push("lock")
      sql = strings.join("?")
      values = rest

      return row ? [row] : []
    },
    vendor: {
      update: async (args: unknown) => {
        log.push("update")
        updates.push(args)
      },
    },
    auditLog: {
      create: async (args: { data: unknown }) => {
        log.push("audit")
        audits.push(args.data)

        return { id: "audit-1" }
      },
    },
  } as never

  return {
    tx,
    log,
    updates,
    audits,
    sql: () => sql,
    values: () => values,
  }
}

const AT = 1_780_000_000

const evt = (
  object: unknown,
  created = AT,
  id = "evt_1"
): StripeWebhookEvent => ({
  id,
  type: "account.updated",
  created,
  data: { object },
})

const vendor = (over: Partial<Row> = {}): Row => ({
  id: "v1",
  stripeOnboardingComplete: false,
  stripeStatusAt: null,
  ...over,
})

describe("handleAccountUpdated", () => {
  it("is registered for account.updated in the dispatch table", () => {
    expect(stripeHandlers["account.updated"]).toBe(handleAccountUpdated)
  })

  it("TC-E4S2-01: sets the flag, the summary and the timestamp when Stripe says ready", async () => {
    const t = setup(vendor())

    await handleAccountUpdated(evt(account()), t.tx)

    expect(t.updates).toEqual([
      {
        where: { id: "v1" },
        data: {
          stripeOnboardingComplete: true,
          stripeRequirementsDue: [],
          stripeDisabledReason: null,
          stripeStatusAt: new Date(AT * 1000),
        },
      },
    ])
  })

  it("TC-E4S2-03: charges without payouts leaves the flag false and stores what is due", async () => {
    const t = setup(vendor())

    await handleAccountUpdated(
      evt(
        account({
          payouts_enabled: false,
          requirements: { currently_due: ["external_account"] },
        })
      ),
      t.tx
    )

    expect(t.updates[0]).toMatchObject({
      data: {
        stripeOnboardingComplete: false,
        stripeRequirementsDue: ["external_account"],
      },
    })
    expect(t.audits).toEqual([])
  })

  it("locks the vendor by Stripe account id before anything is read or written", async () => {
    const t = setup(vendor())

    await handleAccountUpdated(evt(account({ id: "acct_77" })), t.tx)

    expect(t.log).toEqual(["lock", "update", "audit"])
    expect(t.sql()).toContain('FROM "Vendor"')
    expect(t.sql()).toContain('"stripeAccountId" = ?')
    expect(t.sql()).toContain("FOR UPDATE")
    expect(t.values()).toEqual(["acct_77"])
  })

  it("ignores an account that belongs to no vendor", async () => {
    const t = setup(null)

    await handleAccountUpdated(evt(account()), t.tx)

    expect(t.log).toEqual(["lock"])
  })

  it("ignores an event older than the last one applied", async () => {
    const t = setup(vendor({ stripeStatusAt: new Date((AT + 1) * 1000) }))

    await handleAccountUpdated(evt(account()), t.tx)

    expect(t.log).toEqual(["lock"])
  })

  it("applies an event at the same second as the last one, and a newer one", async () => {
    for (const stripeStatusAt of [
      new Date(AT * 1000),
      new Date((AT - 5) * 1000),
    ]) {
      const t = setup(vendor({ stripeStatusAt }))

      await handleAccountUpdated(evt(account()), t.tx)

      expect(t.log).toContain("update")
    }
  })

  it("records an audit row when the vendor becomes payout ready", async () => {
    const t = setup(vendor())

    await handleAccountUpdated(
      evt(account({ id: "acct_1" }), AT, "evt_9"),
      t.tx
    )

    expect(t.audits).toEqual([
      {
        actorId: null,
        action: PAYOUTS_ENABLED_ACTION,
        entityType: "Vendor",
        entityId: "v1",
        meta: { stripeEventId: "evt_9", stripeAccountId: "acct_1" },
      },
    ])
  })

  it("TC-E4S2-02: when Stripe restricts the account later the flag is cleared and audited with what is due", async () => {
    const t = setup(vendor({ stripeOnboardingComplete: true }))

    await handleAccountUpdated(
      evt(
        account({
          payouts_enabled: false,
          requirements: {
            currently_due: ["individual.verification.document"],
            disabled_reason: "requirements.past_due",
          },
        })
      ),
      t.tx
    )

    expect(t.updates[0]).toMatchObject({
      data: {
        stripeOnboardingComplete: false,
        stripeDisabledReason: "requirements.past_due",
      },
    })
    expect(t.audits[0]).toMatchObject({
      action: PAYOUTS_DISABLED_ACTION,
      meta: { requirementsDue: ["individual.verification.document"] },
    })
  })

  it("does not write an audit row when readiness did not change, but still refreshes the summary", async () => {
    for (const was of [true, false]) {
      const t = setup(vendor({ stripeOnboardingComplete: was }))

      await handleAccountUpdated(
        evt(
          account(
            was
              ? {}
              : {
                  charges_enabled: false,
                  payouts_enabled: false,
                  requirements: { currently_due: ["a"] },
                }
          )
        ),
        t.tx
      )

      expect(t.audits).toEqual([])
      expect(t.updates).toHaveLength(1)
    }
  })

  it("fails on a payload it cannot read, before touching the database", async () => {
    const t = setup(vendor())

    await expect(
      handleAccountUpdated(evt({ id: "acct_1" }), t.tx)
    ).rejects.toThrow()
    expect(t.log).toEqual([])
  })
})
