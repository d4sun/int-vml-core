"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { markFulfilled, markNoShow } from "@/lib/services/vendor-bookings"
import { AppError } from "@/lib/errors"

/** Marks a confirmed item fulfilled. A refusal comes back as a message on the page, not an error screen. */
export async function fulfilBookingItemAction(
  formData: FormData
): Promise<void> {
  await run(formData, markFulfilled)
}

export async function noShowBookingItemAction(
  formData: FormData
): Promise<void> {
  await run(formData, markNoShow)
}

async function run(
  formData: FormData,
  action: (id: string) => Promise<void>
): Promise<void> {
  const id = String(formData.get("itemId") ?? "")
  let failure: string | null = null

  try {
    await action(id)
  } catch (error) {
    failure =
      error instanceof AppError
        ? error.message
        : "Something went wrong. Try again."
  }

  revalidatePath("/vendor/bookings")

  if (failure) redirect(`/vendor/bookings?error=${encodeURIComponent(failure)}`)
}
