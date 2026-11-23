"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { runAction, type ActionState } from "@/lib/actions/result"
import { startOnboarding } from "@/lib/services/vendor-onboarding"

export type StartPayoutSetupResult = { status: "complete" }

/**
 * Starts or continues Stripe onboarding for the vendor named in the form and
 * sends the owner to Stripe's hosted page. All checks (owner only, approved
 * vendor) are in the service; the vendor id is just a request to be checked.
 */
export async function startPayoutSetupAction(
  _previous: ActionState<StartPayoutSetupResult> | null,
  formData: FormData
): Promise<ActionState<StartPayoutSetupResult>> {
  const result = await runAction(() =>
    startOnboarding({ vendorId: formData.get("vendorId") ?? undefined })
  )

  if (result.status === "error") return result

  if (result.data.status === "link") redirect(result.data.url)

  revalidatePath("/vendor/payouts/setup")

  return { status: "success", data: { status: "complete" } }
}
