"use client"

import { useActionState } from "react"
import { TextField } from "@/components/auth/text-field"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import type { CategoryRecord } from "@/lib/services/category"
import { CATEGORY_NAME_MAX_LENGTH } from "@/lib/validation/category"

type Action = (
  previous: ActionState<CategoryRecord> | null,
  formData: FormData
) => Promise<ActionState<CategoryRecord>>

export type ParentOption = { id: string; label: string }

export function CategoryForm({
  action,
  parents,
  initial,
  submitLabel,
}: {
  action: Action
  parents: ParentOption[]
  submitLabel: string
  initial?: {
    id: string
    name: string
    slug: string
    parentId: string | null
    commission: string
  }
}) {
  const [state, formAction, pending] = useActionState(action, null)
  const errors = state?.status === "error" ? state.fieldErrors : undefined
  const formError =
    state?.status === "error" && !state.fieldErrors ? state.message : undefined

  return (
    <form
      action={formAction}
      noValidate
      // New values after a save re-key the form so it shows what was stored.
      key={
        initial
          ? `${initial.id}:${initial.name}:${initial.slug}:${initial.parentId}:${initial.commission}`
          : "new"
      }
      className="grid gap-4 sm:grid-cols-2"
    >
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}

      <TextField
        id={initial ? "edit-name" : "name"}
        name="name"
        label="Name"
        maxLength={CATEGORY_NAME_MAX_LENGTH}
        defaultValue={initial?.name ?? ""}
        error={errors?.name?.[0]}
      />
      <TextField
        id={initial ? "edit-slug" : "slug"}
        name="slug"
        label="Slug"
        hint={initial ? undefined : "Leave blank to build it from the name."}
        defaultValue={initial?.slug ?? ""}
        error={errors?.slug?.[0]}
      />

      <div className="space-y-1.5">
        <label
          htmlFor={initial ? "edit-parent" : "parent"}
          className="text-sm font-medium text-vml-ink"
        >
          Parent category
        </label>
        <select
          id={initial ? "edit-parent" : "parent"}
          name="parentId"
          defaultValue={initial?.parentId ?? ""}
          aria-invalid={errors?.parentId ? true : undefined}
          className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">None (top level)</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {errors?.parentId?.[0] ? (
          <p className="text-xs font-medium text-destructive">
            {errors.parentId[0]}
          </p>
        ) : null}
      </div>

      <TextField
        id={initial ? "edit-commission" : "commission"}
        name="commission"
        label="Default commission (%)"
        inputMode="decimal"
        hint="Applies to new bookings only. Up to two decimal places."
        defaultValue={initial?.commission ?? "10"}
        error={errors?.commissionBpsDefault?.[0]}
      />

      <div className="flex flex-col gap-2 sm:col-span-2">
        {formError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {formError}
          </p>
        ) : null}
        {state?.status === "success" ? (
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
