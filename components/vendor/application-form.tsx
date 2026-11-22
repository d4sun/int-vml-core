"use client"

import { useActionState, useState } from "react"
import { TextField } from "@/components/auth/text-field"
import { Button } from "@/components/ui/button"
import type { ActionState } from "@/lib/actions/result"
import type { AppliedVendor } from "@/lib/services/vendor-application"
import {
  VENDOR_DESCRIPTION_MAX_LENGTH,
  VENDOR_NAME_MAX_LENGTH,
} from "@/lib/validation/vendor-application"

type Action = (
  previous: ActionState<AppliedVendor> | null,
  formData: FormData
) => Promise<ActionState<AppliedVendor>>

export function ApplicationForm({
  action,
  accountEmail,
}: {
  action: Action
  accountEmail: string
}) {
  const [state, formAction, pending] = useActionState(action, null)
  // Controlled, so a rejected submission keeps what the person typed (React
  // clears an uncontrolled form after every action).
  const [values, setValues] = useState({
    name: "",
    description: "",
    contactEmail: "",
  })

  const errors = state?.status === "error" ? state.fieldErrors : undefined
  const formError =
    state?.status === "error" && !state.fieldErrors ? state.message : undefined

  const update =
    (field: keyof typeof values) => (event: { target: { value: string } }) =>
      setValues((current) => ({ ...current, [field]: event.target.value }))

  return (
    <form action={formAction} noValidate className="space-y-4">
      <TextField
        id="name"
        name="name"
        label="Business name"
        autoComplete="organization"
        maxLength={VENDOR_NAME_MAX_LENGTH}
        value={values.name}
        onChange={update("name")}
        error={errors?.name?.[0]}
      />

      <div className="space-y-1.5">
        <label
          htmlFor="description"
          className="text-sm font-medium text-vml-ink"
        >
          What do you offer?{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={VENDOR_DESCRIPTION_MAX_LENGTH}
          value={values.description}
          onChange={update("description")}
          aria-invalid={errors?.description ? true : undefined}
          aria-describedby={
            errors?.description ? "description-error" : undefined
          }
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
        {errors?.description?.[0] ? (
          <p
            id="description-error"
            className="text-xs font-medium text-destructive"
          >
            {errors.description[0]}
          </p>
        ) : null}
      </div>

      <TextField
        id="contactEmail"
        name="contactEmail"
        type="email"
        label="Contact email (optional)"
        autoComplete="email"
        hint={`Customers and our team may use this. Leave blank to use ${accountEmail}.`}
        value={values.contactEmail}
        onChange={update("contactEmail")}
        error={errors?.contactEmail?.[0]}
      />

      {formError ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {formError}
        </p>
      ) : null}

      <Button
        type="submit"
        className="h-10 w-full rounded-xl bg-vml-red text-white hover:bg-vml-red/90"
        disabled={pending}
      >
        {pending ? "Sending…" : "Submit application"}
      </Button>
    </form>
  )
}
