import type { Metadata } from "next"
import { headers } from "next/headers"
import Link from "next/link"
import { AuthCard } from "@/components/auth/auth-card"
import { ResendVerificationForm } from "@/components/auth/resend-verification-form"
import { buttonVariants } from "@/components/ui/button"
import { getAuth } from "@/lib/auth"
import { describeVerificationOutcome } from "@/lib/auth/verification"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Verify your email",
  robots: { index: false, follow: false },
}

type SearchParams = Promise<{ error?: string | string[] }>

export default async function VerifyEmailCompletePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { error } = await searchParams
  const requestHeaders = await headers()
  const session = await getAuth().api.getSession({ headers: requestHeaders })

  // An absent `error` proves nothing on its own: anyone can open this URL, so
  // success also requires the signed-in user's email to be verified.
  const outcome = describeVerificationOutcome({
    error: Array.isArray(error) ? error[0] : error,
    emailVerified: session?.user.emailVerified,
  })

  if (outcome.status === "verified") {
    return (
      <AuthCard
        eyebrow="All set"
        title="Email verified"
        description="Thanks — your email address is confirmed and you're signed in."
      >
        <Link
          href="/"
          className={cn(
            buttonVariants(),
            "h-10 w-full rounded-xl bg-vml-red text-white hover:bg-vml-red/90"
          )}
        >
          Continue to Visit My London
        </Link>
      </AuthCard>
    )
  }

  if (outcome.status === "failed") {
    return (
      <AuthCard
        eyebrow="Verification"
        title={
          outcome.reason === "expired"
            ? "This link has expired"
            : "This link isn't valid"
        }
        description={
          outcome.reason === "expired"
            ? "Verification links last one hour. Enter your email and we'll send you a new one."
            : "The link may have been copied incorrectly. Enter your email and we'll send you a new one."
        }
      >
        <ResendVerificationForm />
      </AuthCard>
    )
  }

  return (
    <AuthCard
      eyebrow="Verification"
      title="Check your email"
      description="We sent you a link to confirm your address. Didn't get it? Enter your email and we'll send another."
    >
      <ResendVerificationForm />
    </AuthCard>
  )
}
