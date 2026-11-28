/** The public origin of the app, from configuration. Kept in its own module so tests can avoid it. */
export async function getEnvOrigin(): Promise<string> {
  return (await import("@/lib/env"))
    .getEnv()
    .BETTER_AUTH_URL.replace(/\/+$/, "")
}
