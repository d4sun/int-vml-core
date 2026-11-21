import type { Metadata } from "next"
import Link from "next/link"
import { AuthCard } from "@/components/auth/auth-card"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"
import { buttonVariants } from "@/components/ui/button"
import { describeResetLink } from "@/lib/auth/password-reset"
import { cn } from "@/lib/utils"

// The reset token is in this page's URL, so it must never leak through the
// Referer header to anything the page loads or links to.
export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

type SearchParams = Promise<{
  token?: string | string[]
  error?: string | string[]
}>

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const outcome = describeResetLink({
    token: first(params.token),
    error: first(params.error),
  })

  if (outcome.status === "ready") {
    return (
      <AuthCard
        eyebrow="Account help"
        title="Choose a new password"
        description="Pick something you don't use anywhere else."
      >
        <ResetPasswordForm token={outcome.token} />
      </AuthCard>
    )
  }

  return (
    <AuthCard
      eyebrow="Account help"
      title={
        outcome.status === "invalid"
          ? "This link isn't valid"
          : "Reset your password"
      }
      description={
        outcome.status === "invalid"
          ? "It may have expired, been used already, or been copied incorrectly. Reset links last one hour."
          : "Open the link from your reset email, or request a new one."
      }
    >
      <Link
        href="/forgot-password"
        className={cn(
          buttonVariants(),
          "h-10 w-full rounded-xl bg-vml-red text-white hover:bg-vml-red/90"
        )}
      >
        Request a new link
      </Link>
    </AuthCard>
  )
}
