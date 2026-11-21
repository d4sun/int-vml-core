"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function onClick() {
    setPending(true)
    await authClient.signOut()
    router.push("/")
    router.refresh()
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="h-10 w-full rounded-xl"
      onClick={onClick}
      disabled={pending}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  )
}
