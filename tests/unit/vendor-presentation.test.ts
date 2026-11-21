import { describe, expect, it } from "vitest"
import {
  VENDOR_ACTION_LABEL,
  VENDOR_STATUS_LABEL,
  VENDOR_STATUS_ORDER,
  describeAuditAction,
  parseQueueFilter,
  readAuditDetails,
} from "@/lib/vendors/presentation"
import { VENDOR_ACTIONS, auditActionFor } from "@/lib/vendors/transitions"

describe("vendor presentation", () => {
  it("TC-E8S1-35: every status and action has a label, and the queue order starts with pending", () => {
    expect(Object.keys(VENDOR_STATUS_LABEL).sort()).toEqual([
      "APPROVED",
      "PENDING",
      "REJECTED",
      "SUSPENDED",
    ])
    expect([...VENDOR_STATUS_ORDER].sort()).toEqual(
      Object.keys(VENDOR_STATUS_LABEL).sort()
    )
    expect(VENDOR_STATUS_ORDER[0]).toBe("PENDING")

    for (const action of VENDOR_ACTIONS) {
      expect(VENDOR_ACTION_LABEL[action].length).toBeGreaterThan(0)
    }
  })

  it("TC-E8S1-36: every audit verb the state machine can write has a readable label", () => {
    for (const action of VENDOR_ACTIONS) {
      const verb = auditActionFor(action)

      expect(describeAuditAction(verb), verb).not.toBe(verb)
    }

    expect(describeAuditAction("vendor.something_new")).toBe(
      "vendor.something_new"
    )
  })
})

describe("parseQueueFilter", () => {
  it("TC-E8S1-37: defaults to the pending queue and accepts only real statuses or ALL", () => {
    expect(parseQueueFilter(undefined)).toBe("PENDING")
    expect(parseQueueFilter("APPROVED")).toBe("APPROVED")
    expect(parseQueueFilter("REJECTED")).toBe("REJECTED")
    expect(parseQueueFilter("ALL")).toBe("ALL")
  })

  it("TC-E8S1-38: a hand-edited or hostile value falls back to the default instead of erroring", () => {
    for (const value of [
      "",
      "approved",
      "DELETED",
      "ALL; DROP TABLE",
      "__proto__",
    ]) {
      expect(parseQueueFilter(value), value).toBe("PENDING")
    }

    expect(parseQueueFilter(["SUSPENDED", "APPROVED"])).toBe("SUSPENDED")
    expect(parseQueueFilter([])).toBe("PENDING")
  })
})

describe("readAuditDetails", () => {
  it("TC-E8S1-39: reads from, to and reason, and ignores everything else", () => {
    expect(
      readAuditDetails({
        from: "PENDING",
        to: "REJECTED",
        reason: "No licence",
        secret: "x",
      })
    ).toEqual({ from: "PENDING", to: "REJECTED", reason: "No licence" })
  })

  it("TC-E8S1-40: malformed meta gives no details and never throws", () => {
    for (const meta of [
      null,
      undefined,
      "text",
      5,
      [],
      [1, 2],
      { from: 3, reason: {} },
    ]) {
      expect(readAuditDetails(meta), JSON.stringify(meta)).toEqual({})
    }
  })
})
