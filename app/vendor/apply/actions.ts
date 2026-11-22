"use server"

import { revalidatePath } from "next/cache"
import { runAction, type ActionState } from "@/lib/actions/result"
import {
  applyAsVendor,
  type AppliedVendor,
} from "@/lib/services/vendor-application"

const field = (formData: FormData, name: string) =>
  formData.get(name) ?? undefined

export async function applyAction(
  _previous: ActionState<AppliedVendor> | null,
  formData: FormData
): Promise<ActionState<AppliedVendor>> {
  const result = await runAction(() =>
    applyAsVendor({
      name: field(formData, "name"),
      description: field(formData, "description"),
      contactEmail: field(formData, "contactEmail"),
    })
  )

  if (result.status === "success") revalidatePath("/vendor/apply")

  return result
}
