import type { Metadata } from "next"
import Link from "next/link"
import { AuthCard } from "@/components/auth/auth-card"
import { SignInForm } from "@/components/auth/sign-in-form"
import { safeRedirectPath } from "@/lib/auth/redirect"

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const { next } = await searchParams

  return (
    <AuthCard
      eyebrow="Welcome back"
      title="Sign in"
      description="Sign in to manage your trips and bookings."
      footer={
        <>
          New to Visit My London?{" "}
          <Link
            href="/register"
            className="font-medium text-vml-navy underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <SignInForm redirectTo={safeRedirectPath(next)} />
    </AuthCard>
  )
}
