"use server"

import { revalidatePath } from "next/cache"
import { runAction, type ActionState } from "@/lib/actions/result"
import {
  transitionVendor,
  type GovernedVendor,
} from "@/lib/services/vendor-governance"

export async function transitionVendorAction(
  _previous: ActionState<GovernedVendor> | null,
  formData: FormData
): Promise<ActionState<GovernedVendor>> {
  const reason = formData.get("reason")

  const result = await runAction(() =>
    transitionVendor({
      vendorId: formData.get("vendorId"),
      action: formData.get("action"),
      ...(typeof reason === "string" && reason.trim() ? { reason } : {}),
    })
  )

  if (result.status === "success") {
    revalidatePath("/admin/vendors")
    revalidatePath(`/admin/vendors/${result.data.id}`)
  }

  return result
}
