/**
 * Where to send someone after signing in. Only same-site paths are accepted;
 * anything that could leave the site (absolute URLs, `//host`, `/\host`,
 * `javascript:`) falls back to the default, so `?next=` is never an open
 * redirect.
 */
export function safeRedirectPath(
  next: string | string[] | null | undefined,
  fallback = "/"
): string {
  const value = Array.isArray(next) ? next[0] : next

  if (!value || value.length > 2048) return fallback
  if (!value.startsWith("/")) return fallback
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback
  // Control characters and backslashes can be normalised into a host by some
  // browsers, so refuse them outright.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback

  return value
}
