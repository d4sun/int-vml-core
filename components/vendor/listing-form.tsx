"use client"

import { useActionState } from "react"
import { TextField } from "@/components/auth/text-field"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import type { ListingRecord } from "@/lib/services/listing"
import {
  LISTING_ADDRESS_MAX_LENGTH,
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_TITLE_MAX_LENGTH,
} from "@/lib/validation/listing"

type Action = (
  previous: ActionState<ListingRecord> | null,
  formData: FormData
) => Promise<ActionState<ListingRecord>>

export function ListingForm({
  action,
  categories,
  submitLabel,
  vendorId,
  initial,
}: {
  action: Action
  categories: { id: string; name: string }[]
  submitLabel: string
  vendorId?: string
  initial?: ListingRecord
}) {
  const [state, formAction, pending] = useActionState(action, null)
  const errors = state?.status === "error" ? state.fieldErrors : undefined
  const formError =
    state?.status === "error" && !state.fieldErrors ? state.message : undefined

  return (
    <form
      action={formAction}
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      // A saved listing re-keys the form so it shows what was stored.
      key={initial ? `${initial.id}:${initial.title}:${initial.status}` : "new"}
    >
      {vendorId ? (
        <input type="hidden" name="vendorId" value={vendorId} />
      ) : null}
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div className="sm:col-span-2">
        <TextField
          id="title"
          name="title"
          label="Title"
          maxLength={LISTING_TITLE_MAX_LENGTH}
          defaultValue={initial?.title ?? ""}
          error={errors?.title?.[0]}
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="categoryId"
          className="text-sm font-medium text-vml-ink"
        >
          Category
        </label>
        <select
          id="categoryId"
          name="categoryId"
          defaultValue={initial?.categoryId ?? ""}
          aria-invalid={errors?.categoryId ? true : undefined}
          className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="" disabled>
            Choose a category
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {errors?.categoryId?.[0] ? (
          <p className="text-xs font-medium text-destructive">
            {errors.categoryId[0]}
          </p>
        ) : null}
      </div>

      <TextField
        id="address"
        name="address"
        label="Address (optional)"
        maxLength={LISTING_ADDRESS_MAX_LENGTH}
        defaultValue={initial?.address ?? ""}
        error={errors?.address?.[0]}
      />

      <div className="space-y-1.5 sm:col-span-2">
        <label
          htmlFor="description"
          className="text-sm font-medium text-vml-ink"
        >
          Description (optional)
        </label>
        <textarea
          id="description"
          name="description"
          rows={5}
          maxLength={LISTING_DESCRIPTION_MAX_LENGTH}
          defaultValue={initial?.description ?? ""}
          aria-invalid={errors?.description ? true : undefined}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {errors?.description?.[0] ? (
          <p className="text-xs font-medium text-destructive">
            {errors.description[0]}
          </p>
        ) : null}
      </div>

      <TextField
        id="lat"
        name="lat"
        label="Latitude (optional)"
        inputMode="decimal"
        defaultValue={initial?.lat ?? ""}
        error={errors?.lat?.[0]}
      />
      <TextField
        id="lng"
        name="lng"
        label="Longitude (optional)"
        inputMode="decimal"
        defaultValue={initial?.lng ?? ""}
        error={errors?.lng?.[0]}
      />

      <div className="flex flex-col gap-2 sm:col-span-2">
        {formError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {formError}
          </p>
        ) : null}
        {state?.status === "success" && initial ? (
          <p role="status" className="text-sm text-vml-ink">
            Saved.
          </p>
        ) : null}
        <div>
          <Button
            type="submit"
            disabled={pending}
            className="h-10 rounded-xl bg-vml-red px-5 text-white hover:bg-vml-red/90"
          >
            {pending ? "Saving…" : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  )
}
