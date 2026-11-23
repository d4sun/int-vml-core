import { z } from "zod"

/**
 * The caller names the vendor and nothing else. Strict, so a client cannot
 * smuggle in an account id, a status or a return URL.
 */
export const startOnboardingSchema = z.strictObject({
  vendorId: z.string().trim().min(1, "Choose a vendor"),
})

export type StartOnboardingInput = z.infer<typeof startOnboardingSchema>
