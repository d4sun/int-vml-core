"use server"

import { revalidatePath } from "next/cache"
import { runAction, type ActionState } from "@/lib/actions/result"
import { percentToBps } from "@/lib/categories/commission"
import {
  setVendorCommission,
  type VendorCommission,
} from "@/lib/services/vendor-commission"
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

export async function setVendorCommissionAction(
  _previous: ActionState<VendorCommission> | null,
  formData: FormData
): Promise<ActionState<VendorCommission>> {
  const vendorId = formData.get("vendorId")
  const text = formData.get("commission")
  // A blank box clears the override, so the vendor uses each category's default.
  const commissionBps =
    typeof text === "string" && text.trim() === ""
      ? null
      : typeof text === "string"
        ? percentToBps(text)
        : Number.NaN

  const result = await runAction(() =>
    setVendorCommission({ vendorId, commissionBps })
  )

  if (result.status === "success") {
    revalidatePath("/admin/vendors")
    revalidatePath(`/admin/vendors/${result.data.id}`)
  }

  return result
}
