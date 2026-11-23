import type { CategoryType, Prisma, PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireAdmin, type SessionSource } from "@/lib/auth/guards"
import { categorySlug } from "@/lib/categories/slug"
import {
  MAX_CATEGORY_DEPTH,
  buildCategoryTree,
  parentProblem,
  type CategoryNode,
  type ParentProblem,
} from "@/lib/categories/tree"
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors"
import { audit } from "@/lib/services/audit"
import {
  createCategorySchema,
  deleteCategorySchema,
  updateCategorySchema,
} from "@/lib/validation/category"

export type CategoryRecord = {
  id: string
  name: string
  slug: string
  parentId: string | null
  type: CategoryType
  commissionBpsDefault: number
}

export type CategoryListItem = CategoryRecord & { listingCount: number }

export type CategoryDeps = {
  session?: SessionSource
  db?: Pick<PrismaClient, "$transaction" | "category">
  /** Overridable so tests can prove each change and its audit row are atomic. */
  record?: typeof audit.record
}

/** One key for every write to the category tree (see `lockTree`). */
const TREE_LOCK_KEY = 9_203_001

const SELECT = {
  id: true,
  name: true,
  slug: true,
  parentId: true,
  type: true,
  commissionBpsDefault: true,
} as const

const PROBLEM_MESSAGE: Record<ParentProblem, string> = {
  MISSING_PARENT: "That parent category does not exist",
  SELF_PARENT: "A category cannot be its own parent",
  CYCLE: "A category cannot be moved under one of its own sub-categories",
  TOO_DEEP: `Categories can be nested at most ${MAX_CATEGORY_DEPTH} levels deep`,
}

/**
 * Serialises category writes for the length of the transaction. Cycle and
 * depth checks read the whole tree, so two moves at once (A under B while B
 * goes under A) could each pass its own check and together make a loop. The
 * lock is released at commit or rollback.
 */
async function lockTree(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TREE_LOCK_KEY})`
}

function checkParent(
  rows: CategoryRecord[],
  id: string | null,
  parentId: string | null
): void {
  const problem = parentProblem(rows, id, parentId)

  if (problem) {
    throw new ValidationError("Please check the highlighted fields.", {
      parentId: [PROBLEM_MESSAGE[problem]],
    })
  }
}

function checkSlug(
  rows: CategoryRecord[],
  slug: string,
  exceptId: string | null
): void {
  if (rows.some((row) => row.slug === slug && row.id !== exceptId)) {
    throw new ConflictError("Another category already uses that slug", {
      fieldErrors: { slug: ["Another category already uses that slug"] },
    })
  }
}

/**
 * Admin-only category management (CR-1). Every write takes the tree lock,
 * reads the whole tree (a few dozen rows), validates against it and writes
 * its audit row in the same transaction.
 */
export async function createCategory(
  input: unknown,
  deps: CategoryDeps = {}
): Promise<CategoryRecord> {
  const actor = await requireAdmin(deps.session)
  const parsed = createCategorySchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const data = parsed.data
  const slug = data.slug ?? categorySlug(data.name)

  if (!slug) {
    throw new ValidationError("Please check the highlighted fields.", {
      slug: ["Enter a slug: the name has no letters or numbers to build one"],
    })
  }

  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const record = deps.record ?? audit.record

  return db.$transaction(async (tx) => {
    await lockTree(tx)

    const rows = await tx.category.findMany({ select: SELECT })

    // A generated slug that is a page of the site, or is taken, is reported
    // against the slug field so the admin can choose another.
    if (data.slug === undefined) validateGeneratedSlug(slug)

    checkSlug(rows, slug, null)
    checkParent(rows, null, data.parentId ?? null)

    const created = await tx.category.create({
      data: {
        name: data.name,
        slug,
        parentId: data.parentId ?? null,
        type: data.type,
        commissionBpsDefault: data.commissionBpsDefault,
      },
      select: SELECT,
    })

    await record(tx, {
      actorId: actor.id,
      action: "category.created",
      entityType: "Category",
      entityId: created.id,
      meta: {
        name: created.name,
        slug: created.slug,
        parentId: created.parentId,
        commissionBpsDefault: created.commissionBpsDefault,
      },
    })

    return created
  })
}

function validateGeneratedSlug(slug: string): void {
  const result = createCategorySchema.shape.slug.safeParse(slug)

  if (!result.success) {
    throw new ValidationError("Please check the highlighted fields.", {
      slug: result.error.issues.map((issue) => issue.message),
    })
  }
}

export async function updateCategory(
  input: unknown,
  deps: CategoryDeps = {}
): Promise<CategoryRecord> {
  const actor = await requireAdmin(deps.session)
  const parsed = updateCategorySchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { id, ...changes } = parsed.data
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const record = deps.record ?? audit.record

  return db.$transaction(async (tx) => {
    await lockTree(tx)

    const rows = await tx.category.findMany({ select: SELECT })
    const current = rows.find((row) => row.id === id)

    if (!current) throw new NotFoundError("Category not found")

    if (changes.slug !== undefined) checkSlug(rows, changes.slug, id)

    if (
      changes.parentId !== undefined &&
      changes.parentId !== current.parentId
    ) {
      checkParent(rows, id, changes.parentId)
    }

    const next = {
      name: changes.name ?? current.name,
      slug: changes.slug ?? current.slug,
      parentId:
        changes.parentId === undefined ? current.parentId : changes.parentId,
      commissionBpsDefault:
        changes.commissionBpsDefault ?? current.commissionBpsDefault,
    }

    const changed = (
      ["name", "slug", "parentId", "commissionBpsDefault"] as const
    ).filter((field) => next[field] !== current[field])

    // Nothing actually differs: no write and no audit row.
    if (changed.length === 0) return current

    const updated = await tx.category.update({
      where: { id },
      data: next,
      select: SELECT,
    })

    await record(tx, {
      actorId: actor.id,
      action: "category.updated",
      entityType: "Category",
      entityId: id,
      meta: {
        changes: Object.fromEntries(
          changed.map((field) => [
            field,
            { from: current[field], to: next[field] },
          ])
        ),
      },
    })

    return updated
  })
}

/**
 * Deletes an empty leaf category. A category with listings is refused
 * (TC-E9S2-01), as is one with sub-categories: the admin moves or removes
 * them first, so nothing is orphaned and nothing is deleted by surprise.
 */
export async function deleteCategory(
  input: unknown,
  deps: CategoryDeps = {}
): Promise<{ id: string }> {
  const actor = await requireAdmin(deps.session)
  const parsed = deleteCategorySchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const { id } = parsed.data
  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const record = deps.record ?? audit.record

  return db.$transaction(async (tx) => {
    await lockTree(tx)

    const category = await tx.category.findUnique({
      where: { id },
      select: SELECT,
    })

    if (!category) throw new NotFoundError("Category not found")

    const [listings, children] = await Promise.all([
      tx.listing.count({ where: { categoryId: id } }),
      tx.category.count({ where: { parentId: id } }),
    ])

    if (listings > 0) {
      throw new ConflictError(
        "This category has listings. Move them to another category first.",
        { details: { reason: "HAS_LISTINGS", listings } }
      )
    }

    if (children > 0) {
      throw new ConflictError(
        "This category has sub-categories. Move or delete them first.",
        { details: { reason: "HAS_CHILDREN", children } }
      )
    }

    await tx.category.delete({ where: { id } })

    await record(tx, {
      actorId: actor.id,
      action: "category.deleted",
      entityType: "Category",
      entityId: id,
      meta: {
        name: category.name,
        slug: category.slug,
        parentId: category.parentId,
        commissionBpsDefault: category.commissionBpsDefault,
      },
    })

    return { id }
  })
}

/** The whole tree with listing counts, for the admin editor. Admin only. */
export async function getCategoryTree(
  deps: Pick<CategoryDeps, "session" | "db"> = {}
): Promise<CategoryNode<CategoryListItem>[]> {
  await requireAdmin(deps.session)

  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const rows = await db.category.findMany({
    select: { ...SELECT, _count: { select: { listings: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  })

  return buildCategoryTree(
    rows.map(({ _count, ...row }) => ({
      ...row,
      listingCount: _count.listings,
    }))
  )
}
