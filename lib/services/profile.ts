import type { PlatformRole, PrismaClient } from "@prisma/client"
import { toNormalizedError } from "@/lib/actions/result"
import { requireUser, type SessionSource } from "@/lib/auth/guards"
import { NotFoundError } from "@/lib/errors"
import { profileSchema } from "@/lib/validation/auth"

export type Profile = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  /** Read-only: shown to the user, never writable through this service. */
  platformRole: PlatformRole
}

/**
 * The only writes profile editing can make. The method takes a name and
 * nothing else, so there is no code path from input to `platformRole`.
 */
export type ProfileStore = {
  findById(id: string): Promise<Profile | null>
  updateName(id: string, name: string): Promise<Profile | null>
}

const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  platformRole: true,
} as const

export function prismaProfileStore(
  prisma: Pick<PrismaClient, "user">
): ProfileStore {
  return {
    findById: (id) =>
      prisma.user.findUnique({ where: { id }, select: PROFILE_SELECT }),

    async updateName(id, name) {
      const { count } = await prisma.user.updateMany({
        where: { id },
        data: { name },
      })

      return count === 0
        ? null
        : prisma.user.findUnique({ where: { id }, select: PROFILE_SELECT })
    },
  }
}

export type ProfileDeps = {
  session?: SessionSource
  store?: ProfileStore
}

async function resolveStore(deps: ProfileDeps): Promise<ProfileStore> {
  if (deps.store) return deps.store

  const { prisma } = await import("@/lib/prisma")

  return prismaProfileStore(prisma)
}

/** The caller's own profile. There is no way to ask for anyone else's. */
export async function getProfile(deps: ProfileDeps = {}): Promise<Profile> {
  const actor = await requireUser(deps.session)
  const profile = await (await resolveStore(deps)).findById(actor.id)

  if (!profile) throw new NotFoundError("Profile not found")

  return profile
}

/**
 * Updates the caller's own name. The target row comes from the session, never
 * from the input, and the strict schema rejects any other field (including a
 * different `id` or `platformRole`) instead of ignoring it.
 */
export async function updateProfile(
  input: unknown,
  deps: ProfileDeps = {}
): Promise<Profile> {
  const actor = await requireUser(deps.session)

  const parsed = profileSchema.safeParse(input)

  if (!parsed.success) throw toNormalizedError(parsed.error)

  const profile = await (
    await resolveStore(deps)
  ).updateName(actor.id, parsed.data.name)

  if (!profile) throw new NotFoundError("Profile not found")

  return profile
}
