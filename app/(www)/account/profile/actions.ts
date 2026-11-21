"use server"

import { revalidatePath } from "next/cache"
import { runAction, type ActionState } from "@/lib/actions/result"
import { updateProfile, type Profile } from "@/lib/services/profile"

export async function updateProfileAction(
  _previous: ActionState<Profile> | null,
  formData: FormData
): Promise<ActionState<Profile>> {
  const result = await runAction(() =>
    updateProfile({ name: formData.get("name") })
  )

  if (result.status === "success") revalidatePath("/account/profile")

  return result
}
