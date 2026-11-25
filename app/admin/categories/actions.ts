"use server"

import { revalidatePath } from "next/cache"
import { runAction, type ActionState } from "@/lib/actions/result"
import { percentToBps } from "@/lib/categories/commission"
import {
  createCategory,
  deleteCategory,
  updateCategory,
  type CategoryRecord,
} from "@/lib/services/category"

const text = (formData: FormData, name: string) => {
  const value = formData.get(name)

  return typeof value === "string" ? value : undefined
}

/** A blank optional field is "not given"; the parent select uses "" for top level. */
const optional = (formData: FormData, name: string) => {
  const value = text(formData, name)?.trim()

  return value ? value : undefined
}

const commission = (formData: FormData) => {
  const value = text(formData, "commission")

  return value === undefined || value.trim() === ""
    ? undefined
    : percentToBps(value)
}

const done = <T>(result: ActionState<T>) => {
  if (result.status === "success") revalidatePath("/admin/categories")

  return result
}

export async function createCategoryAction(
  _previous: ActionState<CategoryRecord> | null,
  formData: FormData
): Promise<ActionState<CategoryRecord>> {
  const slug = optional(formData, "slug")
  const parentId = optional(formData, "parentId")
  const bps = commission(formData)

  return done(
    await runAction(() =>
      createCategory({
        name: text(formData, "name"),
        ...(slug ? { slug } : {}),
        ...(parentId ? { parentId } : {}),
        ...(bps === undefined ? {} : { commissionBpsDefault: bps }),
      })
    )
  )
}

export async function updateCategoryAction(
  _previous: ActionState<CategoryRecord> | null,
  formData: FormData
): Promise<ActionState<CategoryRecord>> {
  const bps = commission(formData)

  return done(
    await runAction(() =>
      updateCategory({
        id: text(formData, "id"),
        name: text(formData, "name"),
        slug: optional(formData, "slug"),
        // "" means top level.
        parentId: optional(formData, "parentId") ?? null,
        ...(bps === undefined ? {} : { commissionBpsDefault: bps }),
      })
    )
  )
}

export async function deleteCategoryAction(
  _previous: ActionState<{ id: string }> | null,
  formData: FormData
): Promise<ActionState<{ id: string }>> {
  return done(
    await runAction(() => deleteCategory({ id: text(formData, "id") }))
  )
}
