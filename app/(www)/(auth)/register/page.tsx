import type { Metadata } from "next"
import Link from "next/link"
import { AuthCard } from "@/components/auth/auth-card"
import { RegisterForm } from "@/components/auth/register-form"

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Create a Visit My London account to plan trips and book experiences.",
}

export default function RegisterPage() {
  return (
    <AuthCard
      eyebrow="Join Visit My London"
      title="Create your account"
      description="Save places, plan your trip and book everything London in one place."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-vml-navy underline">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  )
}
