import type { VendorStatus } from "@prisma/client"
import { describe, expect, it } from "vitest"
import { ConflictError } from "@/lib/errors"
import {
  REASON_MAX_LENGTH,
  vendorTransitionSchema,
} from "@/lib/validation/vendor-governance"
import {
  VENDOR_ACTIONS,
  allowedActions,
  auditActionFor,
  canTransition,
  nextVendorStatus,
  type VendorAction,
} from "@/lib/vendors/transitions"

const STATUSES: VendorStatus[] = [
  "PENDING",
  "APPROVED",
  "SUSPENDED",
  "REJECTED",
]

// Written out by hand from the story, not derived from the module under test.
const LEGAL: Record<
  VendorStatus,
  Partial<Record<VendorAction, VendorStatus>>
> = {
  PENDING: { approve: "APPROVED", reject: "REJECTED" },
  APPROVED: { suspend: "SUSPENDED" },
  SUSPENDED: { reinstate: "APPROVED" },
  REJECTED: {},
}

describe("vendor status transitions", () => {
  it("TC-E8S1-05: every legal transition leads to the expected status", () => {
    for (const status of STATUSES) {
      for (const [action, to] of Object.entries(LEGAL[status])) {
        expect(nextVendorStatus(status, action as VendorAction)).toBe(to)
        expect(canTransition(status, action as VendorAction)).toBe(true)
      }
    }
  })

  it("TC-E8S1-06: every other combination is a ConflictError (all 16 checked)", () => {
    let checked = 0

    for (const status of STATUSES) {
      for (const action of VENDOR_ACTIONS) {
        checked += 1
        if (LEGAL[status][action]) continue

        expect(canTransition(status, action), `${status} ${action}`).toBe(false)
        expect(
          () => nextVendorStatus(status, action),
          `${status} ${action}`
        ).toThrow(ConflictError)
      }
    }

    expect(checked).toBe(16)
  })

  it("TC-E8S1-07: REJECTED is final, and re-approving an approved vendor is refused", () => {
    expect(allowedActions("REJECTED")).toEqual([])
    expect(() => nextVendorStatus("APPROVED", "approve")).toThrow(ConflictError)
    expect(() => nextVendorStatus("REJECTED", "approve")).toThrow(ConflictError)
  })

  it("TC-E8S1-08: allowedActions lists exactly the legal buttons", () => {
    expect(allowedActions("PENDING")).toEqual(["approve", "reject"])
    expect(allowedActions("APPROVED")).toEqual(["suspend"])
    expect(allowedActions("SUSPENDED")).toEqual(["reinstate"])
  })

  it("TC-E8S1-09: each action has its own audit verb", () => {
    expect(VENDOR_ACTIONS.map(auditActionFor)).toEqual([
      "vendor.approved",
      "vendor.rejected",
      "vendor.suspended",
      "vendor.reinstated",
    ])
  })

  it("TC-E8S1-10: the error message names the status and the action", () => {
    expect(() => nextVendorStatus("REJECTED", "approve")).toThrow(
      "A rejected vendor cannot be approved"
    )
  })
})

describe("vendorTransitionSchema", () => {
  it("TC-E8S1-11: reject and suspend need a reason; approve and reinstate do not", () => {
    for (const action of ["reject", "suspend"]) {
      for (const reason of [undefined, "", "   "]) {
        expect(
          vendorTransitionSchema.safeParse({ vendorId: "v1", action, reason })
            .success,
          `${action} ${JSON.stringify(reason)}`
        ).toBe(false)
      }

      expect(
        vendorTransitionSchema.safeParse({
          vendorId: "v1",
          action,
          reason: "Fraud",
        }).success
      ).toBe(true)
    }

    for (const action of ["approve", "reinstate"]) {
      expect(
        vendorTransitionSchema.safeParse({ vendorId: "v1", action }).success
      ).toBe(true)
    }
  })

  it("TC-E8S1-12: trims input, bounds the reason and rejects unknown actions", () => {
    expect(
      vendorTransitionSchema.parse({
        vendorId: "  v1 ",
        action: "reject",
        reason: "  Not a real business ",
      })
    ).toEqual({
      vendorId: "v1",
      action: "reject",
      reason: "Not a real business",
    })

    expect(
      vendorTransitionSchema.safeParse({
        vendorId: "v1",
        action: "reject",
        reason: "x".repeat(REASON_MAX_LENGTH + 1),
      }).success
    ).toBe(false)
    expect(
      vendorTransitionSchema.safeParse({ vendorId: "v1", action: "delete" })
        .success
    ).toBe(false)
    expect(
      vendorTransitionSchema.safeParse({ vendorId: "  ", action: "approve" })
        .success
    ).toBe(false)
  })

  it("TC-E8S1-13: a caller cannot name a target status or an approver", () => {
    for (const extra of [
      { status: "APPROVED" },
      { approvedByAdminId: "someone" },
      { id: "v1" },
    ]) {
      expect(
        vendorTransitionSchema.safeParse({
          vendorId: "v1",
          action: "approve",
          ...extra,
        }).success,
        Object.keys(extra)[0]
      ).toBe(false)
    }
  })
})
