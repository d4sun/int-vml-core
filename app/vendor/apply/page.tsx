import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { AuthCard } from "@/components/auth/auth-card"
import { ApplicationForm } from "@/components/vendor/application-form"
import { VendorStatusBadge } from "@/components/admin/vendor-status-badge"
import { buttonVariants } from "@/components/ui/button"
import { UnauthenticatedError } from "@/lib/errors"
import { getApplicationStatus } from "@/lib/services/vendor-application"
import { cn } from "@/lib/utils"
import { applyAction } from "./actions"

export const metadata: Metadata = {
  title: "Become a vendor",
  robots: { index: false, follow: false },
}

const when = (date: Date) =>
  date.toLocaleDateString("en-GB", { timeZone: "Europe/London" })

export default async function VendorApplyPage() {
  const status = await getApplicationStatus().catch((error: unknown) => {
    if (error instanceof UnauthenticatedError) {
      redirect("/sign-in?next=/vendor/apply")
    }

    throw error
  })
  const { application, canApply, email } = status

  if (!canApply) {
    return (
      <AuthCard
        eyebrow="Sell on Visit My London"
        title="Administrators can't apply"
        description="Vendor applications are for customer accounts. Use a separate customer account to apply."
      />
    )
  }

  if (application?.status === "PENDING") {
    return (
      <AuthCard
        eyebrow="Sell on Visit My London"
        title="Your application is under review"
        description="Thanks for applying. We'll email you as soon as it has been decided."
      >
        <ApplicationCard application={application} />
      </AuthCard>
    )
  }

  if (application?.status === "APPROVED") {
    return (
      <AuthCard
        eyebrow="Sell on Visit My London"
        title="You're approved"
        description="Your vendor account is active."
      >
        <ApplicationCard application={application} />
        <Link
          href="/vendor"
          className={cn(
            buttonVariants(),
            "mt-4 h-10 w-full rounded-xl bg-vml-red text-white hover:bg-vml-red/90"
          )}
        >
          Open your vendor dashboard
        </Link>
      </AuthCard>
    )
  }

  if (application?.status === "SUSPENDED") {
    return (
      <AuthCard
        eyebrow="Sell on Visit My London"
        title="Your vendor account is suspended"
        description="Your listings are hidden and new bookings are paused. If you think this is a mistake, please contact our support team."
      >
        <ApplicationCard application={application} />
      </AuthCard>
    )
  }

  return (
    <AuthCard
      eyebrow="Sell on Visit My London"
      title={
        application?.status === "REJECTED" ? "Apply again" : "Become a vendor"
      }
      description={
        application?.status === "REJECTED"
          ? "Your last application wasn't approved. You're welcome to apply again once the points below have been addressed."
          : "Tell us about your business. A member of our team reviews every application, and we'll email you the outcome."
      }
    >
      {application?.status === "REJECTED" ? (
        <div className="mb-6">
          <ApplicationCard application={application} />
        </div>
      ) : null}
      <ApplicationForm action={applyAction} accountEmail={email} />
    </AuthCard>
  )
}

function ApplicationCard({
  application,
}: {
  application: NonNullable<
    Awaited<ReturnType<typeof getApplicationStatus>>["application"]
  >
}) {
  return (
    <div
      data-testid="application-card"
      className="space-y-2 rounded-xl border border-border bg-muted/40 p-4 text-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-vml-ink">{application.name}</span>
        <VendorStatusBadge status={application.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        Applied {when(application.createdAt)}
      </p>
      {application.reason ? (
        <p className="text-vml-ink">Reason: {application.reason}</p>
      ) : null}
    </div>
  )
}
