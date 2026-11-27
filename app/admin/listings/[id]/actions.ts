"use server"

import { revalidatePath } from "next/cache"
import { runAction, type ActionState } from "@/lib/actions/result"
import {
  moderateListing,
  type ModeratedListing,
} from "@/lib/services/listing-moderation"

export async function moderateListingAction(
  _previous: ActionState<ModeratedListing> | null,
  formData: FormData
): Promise<ActionState<ModeratedListing>> {
  const reason = formData.get("reason")

  const result = await runAction(() =>
    moderateListing({
      listingId: formData.get("listingId"),
      action: formData.get("action"),
      ...(typeof reason === "string" && reason.trim() ? { reason } : {}),
    })
  )

  if (result.status === "success") {
    revalidatePath("/admin/listings")
    revalidatePath(`/admin/listings/${result.data.id}`)
  }

  return result
}
