import { inferAdditionalFields } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"
import type { Auth } from "@/lib/auth/config"

// Same-origin: no baseURL, so the client always talks to the page's own host.
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<Auth>()],
})

export const { signUp, signIn, signOut, useSession } = authClient
