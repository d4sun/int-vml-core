import type { Metadata } from "next"
import Link from "next/link"
import { CategoryDelete } from "@/components/admin/category-delete"
import {
  CategoryForm,
  type ParentOption,
} from "@/components/admin/category-form"
import { SurfaceShell } from "@/components/surface-shell"
import { enforceSurface } from "@/lib/auth/enforce-surface"
import { bpsToPercent } from "@/lib/categories/commission"
import { descendantIds, flattenCategoryTree } from "@/lib/categories/tree"
import { getCategoryTree } from "@/lib/services/category"
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from "./actions"

export const metadata: Metadata = { title: "Categories" }

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[] }>
}) {
  await enforceSurface("admin", "/admin/categories")

  const editId = first((await searchParams).edit)
  const flat = flattenCategoryTree(await getCategoryTree())
  const editing = flat.find((c) => c.id === editId)

  // Never offer a category itself or anything beneath it as its own parent.
  const blocked = editing ? descendantIds(flat, editing.id) : new Set<string>()
  const parents: ParentOption[] = flat
    .filter((c) => !blocked.has(c.id))
    .map((c) => ({ id: c.id, label: `${"— ".repeat(c.depth)}${c.name}` }))

  return (
    <SurfaceShell eyebrow="Admin" title="Categories">
      <div className="space-y-10">
        {editing ? (
          <section
            data-testid="category-edit"
            aria-labelledby="edit-heading"
            className="space-y-4 rounded-2xl border border-border p-5"
          >
            <div className="flex items-center justify-between">
              <h2
                id="edit-heading"
                className="text-lg font-semibold text-vml-ink"
              >
                Edit {editing.name}
              </h2>
              <Link href="/admin/categories" className="text-sm underline">
                Close
              </Link>
            </div>
            <CategoryForm
              action={updateCategoryAction}
              parents={parents}
              submitLabel="Save changes"
              initial={{
                id: editing.id,
                name: editing.name,
                slug: editing.slug,
                parentId: editing.parentId,
                commission: bpsToPercent(editing.commissionBpsDefault),
              }}
            />
            <CategoryDelete id={editing.id} action={deleteCategoryAction} />
          </section>
        ) : null}

        <section aria-labelledby="tree-heading">
          <h2 id="tree-heading" className="sr-only">
            All categories
          </h2>
          {flat.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              There are no categories yet. Add the first one below.
            </p>
          ) : (
            <ul
              data-testid="category-tree"
              className="divide-y rounded-2xl border"
            >
              {flat.map((c) => (
                <li
                  key={c.id}
                  data-slug={c.slug}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  style={{ paddingLeft: `${1 + c.depth * 1.5}rem` }}
                >
                  <div>
                    <span className="font-semibold text-vml-ink">{c.name}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      /{c.slug}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>
                      {bpsToPercent(c.commissionBpsDefault)}% commission
                    </span>
                    <span>
                      {c.listingCount} listing{c.listingCount === 1 ? "" : "s"}
                    </span>
                    <Link
                      href={`/admin/categories?edit=${c.id}`}
                      aria-label={`Edit ${c.name}`}
                      className="font-medium text-vml-ink underline"
                    >
                      Edit
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="add-heading"
          className="space-y-4 rounded-2xl border border-border p-5"
        >
          <h2 id="add-heading" className="text-lg font-semibold text-vml-ink">
            Add a category
          </h2>
          <CategoryForm
            action={createCategoryAction}
            parents={parents}
            submitLabel="Add category"
          />
        </section>
      </div>
    </SurfaceShell>
  )
}
