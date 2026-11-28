"use server"

import { revalidatePath } from "next/cache"
import { runAction, type ActionState } from "@/lib/actions/result"
import {
  addToCart,
  removeFromCart,
  updateCartItem,
  type Cart,
} from "@/lib/services/cart"

const text = (formData: FormData, name: string) => {
  const value = formData.get(name)

  return typeof value === "string" ? value : undefined
}

/** Adds one slot (or several places of it) from a listing page. Errors come back as state. */
export async function addToCartAction(
  _previous: ActionState<Cart> | null,
  formData: FormData
): Promise<ActionState<Cart>> {
  const quantity = Number(text(formData, "quantity") ?? "1")

  const result = await runAction(() =>
    addToCart({ availabilityId: text(formData, "availabilityId"), quantity })
  )

  if (result.status === "success") revalidatePath("/cart")

  return result
}

export async function updateCartItemFormAction(
  formData: FormData
): Promise<void> {
  const quantity = Number(text(formData, "quantity") ?? "1")

  await runAction(() =>
    updateCartItem({ holdId: text(formData, "holdId"), quantity })
  )
  revalidatePath("/cart")
}

export async function removeCartItemFormAction(
  formData: FormData
): Promise<void> {
  await runAction(() => removeFromCart({ holdId: text(formData, "holdId") }))
  revalidatePath("/cart")
}
