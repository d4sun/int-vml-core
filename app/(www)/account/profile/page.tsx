import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { AuthCard } from "@/components/auth/auth-card"
import { ProfileForm } from "@/components/auth/profile-form"
import { SignOutButton } from "@/components/auth/sign-out-button"
import { UnauthenticatedError } from "@/lib/errors"
import { getProfile } from "@/lib/services/profile"
import { updateProfileAction } from "./actions"

export const metadata: Metadata = {
  title: "Your profile",
  robots: { index: false, follow: false },
}

export default async function ProfilePage() {
  const profile = await getProfile().catch((error: unknown) => {
    if (error instanceof UnauthenticatedError) {
      redirect("/sign-in?next=/account/profile")
    }

    throw error
  })

  return (
    <AuthCard
      eyebrow="Your account"
      title="Your profile"
      description={
        <>
          Signed in as <strong>{profile.email}</strong>. Your email address
          can&apos;t be changed here.
        </>
      }
    >
      <div className="space-y-6">
        <ProfileForm name={profile.name} action={updateProfileAction} />
        <SignOutButton />
        <p className="text-center text-sm text-muted-foreground">
          Run a tour, venue or event?{" "}
          <Link
            href="/vendor/apply"
            className="font-medium text-vml-navy underline"
          >
            Become a vendor
          </Link>
        </p>
      </div>
    </AuthCard>
  )
}
