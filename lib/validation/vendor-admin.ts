import { VendorStatus } from "@prisma/client"
import { z } from "zod"

export const vendorListSchema = z.strictObject({
  status: z.enum(VendorStatus).optional(),
})

export const vendorIdSchema = z.string().trim().min(1, "Choose a vendor")

export type VendorListInput = z.infer<typeof vendorListSchema>
