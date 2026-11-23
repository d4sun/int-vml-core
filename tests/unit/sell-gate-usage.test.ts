import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  findUngatedSellPaths,
  readSourceFiles,
} from "../helpers/sell-gate-scan"

const root = fileURLToPath(new URL("../..", import.meta.url))

describe("sell gate tripwire", () => {
  it("flags a module that publishes a listing without the gate", () => {
    expect(
      findUngatedSellPaths([
        {
          path: "lib/services/listing.ts",
          text: `await tx.listing.update({ where, data: { status: "PUBLISHED" } })`,
        },
      ])
    ).toEqual([{ path: "lib/services/listing.ts", kind: "publish" }])
  })

  it("flags a module that creates a transfer without the gate", () => {
    for (const text of [
      "await tx.transfer.create({ data })",
      "await prisma.transfer.createMany({ data })",
      "await stripe.createTransfer({ amount })",
      "await client.transfers.create({ amount })",
    ]) {
      expect(findUngatedSellPaths([{ path: "lib/x.ts", text }])).toEqual([
        { path: "lib/x.ts", kind: "payout" },
      ])
    }
  })

  it("accepts the same code once it calls assertVendorCanSell", () => {
    expect(
      findUngatedSellPaths([
        {
          path: "lib/services/listing.ts",
          text: `await assertVendorCanSell(id, tx)\nawait tx.listing.update({ data: { status: "PUBLISHED" } })`,
        },
        {
          path: "lib/services/payout.ts",
          text: `await assertVendorCanSell(id, tx)\nawait tx.transfer.create({ data })`,
        },
      ])
    ).toEqual([])
  })

  it("does not flag reads of published listings or other listing writes", () => {
    expect(
      findUngatedSellPaths([
        {
          path: "lib/search.ts",
          text: `prisma.listing.findMany({ where: { status: "PUBLISHED" } })`,
        },
        {
          path: "lib/services/listing.ts",
          text: `tx.listing.update({ data: { status: "DRAFT" } })`,
        },
      ])
    ).toEqual([])
  })

  it("the application has no publish or payout path that skips the gate", () => {
    const files = readSourceFiles(root, ["lib", "app", "components"])

    // The scan must actually be reading the source tree.
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((f) => f.path === "lib/catalog/visibility.ts")).toBe(true)
    expect(findUngatedSellPaths(files)).toEqual([])
  })
})
