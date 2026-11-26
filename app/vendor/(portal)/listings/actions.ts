"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { runAction, type ActionState } from "@/lib/actions/result"
import {
  createListing,
  submitListing,
  updateListing,
  type ListingRecord,
} from "@/lib/services/listing"
import {
  confirmImageUpload,
  removeImage,
  reorderImages,
  requestImageUpload,
} from "@/lib/services/listing-images"

const text = (formData: FormData, name: string) => {
  const value = formData.get(name)

  return typeof value === "string" ? value : undefined
}

/** A number field: blank is "not given", anything else is parsed strictly. */
const number = (formData: FormData, name: string): number | undefined => {
  const value = text(formData, name)?.trim()

  if (!value) return undefined

  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN
}

export async function createListingAction(
  _previous: ActionState<ListingRecord> | null,
  formData: FormData
): Promise<ActionState<ListingRecord>> {
  const lat = number(formData, "lat")
  const lng = number(formData, "lng")
  const description = text(formData, "description")
  const address = text(formData, "address")

  const result = await runAction(() =>
    createListing({
      vendorId: text(formData, "vendorId"),
      title: text(formData, "title"),
      categoryId: text(formData, "categoryId"),
      ...(description ? { description } : {}),
      ...(address ? { address } : {}),
      ...(lat === undefined ? {} : { lat }),
      ...(lng === undefined ? {} : { lng }),
    })
  )

  if (result.status === "success") {
    revalidatePath("/vendor/listings")
    redirect(`/vendor/listings/${result.data.id}`)
  }

  return result
}

export async function updateListingAction(
  _previous: ActionState<ListingRecord> | null,
  formData: FormData
): Promise<ActionState<ListingRecord>> {
  const lat = number(formData, "lat")
  const lng = number(formData, "lng")

  const result = await runAction(() =>
    updateListing({
      id: text(formData, "id"),
      title: text(formData, "title"),
      categoryId: text(formData, "categoryId"),
      description: text(formData, "description") ?? "",
      address: text(formData, "address") ?? "",
      // Both blank clears the location; one of them alone is reported.
      lat: lat === undefined ? null : lat,
      lng: lng === undefined ? null : lng,
    })
  )

  if (result.status === "success") revalidateListing(result.data.id)

  return result
}

export async function submitListingAction(
  _previous: ActionState<ListingRecord> | null,
  formData: FormData
): Promise<ActionState<ListingRecord>> {
  const result = await runAction(() =>
    submitListing({ id: text(formData, "id") })
  )

  if (result.status === "success") revalidateListing(result.data.id)

  return result
}

function revalidateListing(id: string) {
  revalidatePath("/vendor/listings")
  revalidatePath(`/vendor/listings/${id}`)
}

export type UploadTargetView = {
  key: string
  url: string
  headers: Record<string, string>
}

export async function requestImageUploadAction(input: {
  listingId: string
  contentType: string
  size: number
}): Promise<ActionState<UploadTargetView>> {
  return runAction(async () => {
    const { key, upload } = await requestImageUpload(input)

    return { key, url: upload.url, headers: upload.headers }
  })
}

export async function confirmImageUploadAction(input: {
  listingId: string
  key: string
}): Promise<ActionState<{ id: string }>> {
  const result = await runAction(async () => {
    const image = await confirmImageUpload(input)

    return { id: image.id }
  })

  if (result.status === "success") revalidateListing(input.listingId)

  return result
}

export async function removeImageAction(input: {
  listingId: string
  imageId: string
}): Promise<ActionState<{ id: string }>> {
  const result = await runAction(() => removeImage(input))

  if (result.status === "success") revalidateListing(input.listingId)

  return result
}

export async function reorderImagesAction(input: {
  listingId: string
  imageIds: string[]
}): Promise<ActionState<{ count: number }>> {
  const result = await runAction(async () => ({
    count: (await reorderImages(input)).length,
  }))

  if (result.status === "success") revalidateListing(input.listingId)

  return result
}
