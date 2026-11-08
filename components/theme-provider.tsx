"use client"

import * as React from "react"

/**
 * The site is light-only. This is a pass-through wrapper (kept so existing
 * imports don't change) — there is no theme switching, no system-preference
 * following, and no dark-mode hotkey. The app always renders on a white
 * background via the light `:root` tokens in globals.css.
 */
function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export { ThemeProvider }
