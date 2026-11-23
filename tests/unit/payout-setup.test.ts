import { describe, expect, it } from "vitest"
import type { SessionSource } from "@/lib/auth/guards"
import { getPayoutSetup } from "@/lib/services/payout-setup"
import {
  describePayoutSetup,
  describeRequirement,
  describeRequirements,
} from "@/lib/vendors/payout-setup"

const STATUSES = ["PENDING", "APPROVED", "SUSPENDED", "REJECTED"] as const

describe("describePayoutSetup", () => {
  it("anything not approved is NOT_APPROVED, whatever Stripe last said", () => {
    for (const status of STATUSES.filter((s) => s !== "APPROVED")) {
      for (const stripeOnboardingComplete of [true, false]) {
        for (const stripeAccountId of [null, "acct_1"]) {
          expect(
            describePayoutSetup({
              status,
              stripeAccountId,
              stripeOnboardingComplete,
            }),
            `${status} ${stripeOnboardingComplete} ${stripeAccountId}`
          ).toBe("NOT_APPROVED")
        }
      }
    }
  })

  it("an approved vendor is NOT_STARTED, ACTION_NEEDED or READY by the account and the flag", () => {
    const approved = { status: "APPROVED" as const }

    expect(
      describePayoutSetup({
        ...approved,
        stripeAccountId: null,
        stripeOnboardingComplete: false,
      })
    ).toBe("NOT_STARTED")
    expect(
      describePayoutSetup({
        ...approved,
        stripeAccountId: "acct_1",
        stripeOnboardingComplete: false,
      })
    ).toBe("ACTION_NEEDED")
    expect(
      describePayoutSetup({
        ...approved,
        stripeAccountId: "acct_1",
        stripeOnboardingComplete: true,
      })
    ).toBe("READY")
  })

  it("READY follows the flag even if the account id is missing", () => {
    expect(
      describePayoutSetup({
        status: "APPROVED",
        stripeAccountId: null,
        stripeOnboardingComplete: true,
      })
    ).toBe("READY")
  })
})

describe("describeRequirement", () => {
  it.each([
    ["external_account", "Bank account for payouts"],
    ["business_type", "Business type"],
    ["tos_acceptance.date", "Accept Stripe's terms of service"],
    ["tos_acceptance.ip", "Accept Stripe's terms of service"],
    ["business_profile.url", "Business details"],
    ["company.tax_id", "Company details"],
    ["individual.verification.document", "Identity verification"],
    ["individual.dob.day", "Personal details"],
    ["representative.first_name", "Personal details"],
    ["some_new.field_name", "Some new field name"],
  ])("%s reads as %s", (key, label) => {
    expect(describeRequirement(key)).toBe(label)
  })

  it("never returns an overlong label", () => {
    expect(describeRequirement("x".repeat(500)).length).toBeLessThanOrEqual(80)
  })

  it("lists each kind of need once", () => {
    expect(
      describeRequirements([
        "individual.dob.day",
        "individual.dob.month",
        "external_account",
        "individual.first_name",
      ])
    ).toEqual(["Personal details", "Bank account for payouts"])
  })
})

type Row = {
  role: "OWNER" | "STAFF"
  vendor: {
    id: string
    name: string
    status: "PENDING" | "APPROVED" | "SUSPENDED" | "REJECTED"
    stripeAccountId: string | null
    stripeOnboardingComplete: boolean
    stripeRequirementsDue: string[]
  }
}

const row = (
  id: string,
  over: Partial<Row["vendor"]> = {},
  role: Row["role"] = "OWNER"
): Row => ({
  role,
  vendor: {
    id,
    name: `Vendor ${id}`,
    status: "APPROVED",
    stripeAccountId: null,
    stripeOnboardingComplete: false,
    stripeRequirementsDue: [],
    ...over,
  },
})

const as =
  (id: string | null): SessionSource =>
  async () =>
    id
      ? {
          user: {
            id,
            email: "o@example.com",
            name: "O",
            emailVerified: true,
            platformRole: "VENDOR",
          },
        }
      : null

function setup(rows: Row[], userId: string | null = "u1") {
  const queries: unknown[] = []
  const db = {
    vendorMember: {
      findMany: async (args: unknown) => {
        queries.push(args)

        return rows
      },
    },
  } as never

  return { queries, deps: { session: as(userId), db } }
}

describe("getPayoutSetup", () => {
  it("signed out is a 401 and nothing is read", async () => {
    const t = setup([row("v1")], null)

    await expect(getPayoutSetup({}, t.deps)).rejects.toMatchObject({
      status: 401,
    })
    expect(t.queries).toEqual([])
  })

  it("reads only the caller's memberships, oldest first", async () => {
    const t = setup([row("v1")])

    await getPayoutSetup({}, t.deps)

    expect(t.queries[0]).toMatchObject({
      where: { userId: "u1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
  })

  it("is null for someone who belongs to no vendor", async () => {
    expect(await getPayoutSetup({}, setup([]).deps)).toBeNull()
  })

  it("shows the first vendor by default and the requested one among the caller's own", async () => {
    const rows = [row("v1"), row("v2")]

    expect((await getPayoutSetup({}, setup(rows).deps))?.vendor.id).toBe("v1")
    expect(
      (await getPayoutSetup({ vendorId: "v2" }, setup(rows).deps))?.vendor.id
    ).toBe("v2")
  })

  it("CR-2: a vendor id the caller does not belong to is ignored, never shown", async () => {
    const setupResult = await getPayoutSetup(
      { vendorId: "someone-elses" },
      setup([row("v1")]).deps
    )

    expect(setupResult?.vendor.id).toBe("v1")
    expect(JSON.stringify(setupResult)).not.toContain("someone-elses")
  })

  it("lists the caller's other vendors", async () => {
    const result = await getPayoutSetup(
      { vendorId: "v2" },
      setup([row("v1"), row("v2"), row("v3")]).deps
    )

    expect(result?.otherVendors).toEqual([
      { id: "v1", name: "Vendor v1" },
      { id: "v3", name: "Vendor v3" },
    ])
  })

  it("never returns the Stripe account id", async () => {
    const result = await getPayoutSetup(
      {},
      setup([row("v1", { stripeAccountId: "acct_secret_1" })]).deps
    )

    expect(JSON.stringify(result)).not.toContain("acct_secret_1")
  })

  it("only an owner of an approved vendor that is not ready can start", async () => {
    const cases: [Row, boolean][] = [
      [row("v", {}), true],
      [row("v", { stripeAccountId: "a" }), true],
      [
        row("v", { stripeAccountId: "a", stripeOnboardingComplete: true }),
        false,
      ],
      [row("v", {}, "STAFF"), false],
      [row("v", { status: "SUSPENDED" }), false],
      [row("v", { status: "PENDING" }), false],
      [row("v", { status: "REJECTED" }), false],
    ]

    for (const [r, canStart] of cases) {
      expect(
        (await getPayoutSetup({}, setup([r]).deps))?.canStart,
        JSON.stringify([r.role, r.vendor.status, r.vendor.stripeAccountId])
      ).toBe(canStart)
    }
  })

  it("explains what Stripe needs only while action is needed", async () => {
    const due = ["external_account", "individual.dob.day"]
    const needed = await getPayoutSetup(
      {},
      setup([row("v", { stripeAccountId: "a", stripeRequirementsDue: due })])
        .deps
    )
    const ready = await getPayoutSetup(
      {},
      setup([
        row("v", {
          stripeAccountId: "a",
          stripeOnboardingComplete: true,
          stripeRequirementsDue: due,
        }),
      ]).deps
    )
    const suspended = await getPayoutSetup(
      {},
      setup([
        row("v", {
          status: "SUSPENDED",
          stripeAccountId: "a",
          stripeRequirementsDue: due,
        }),
      ]).deps
    )

    expect(needed?.state).toBe("ACTION_NEEDED")
    expect(needed?.needs).toEqual([
      "Bank account for payouts",
      "Personal details",
    ])
    expect(ready?.needs).toEqual([])
    expect(suspended?.needs).toEqual([])
  })
})
