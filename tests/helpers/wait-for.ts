type WaitForOptions = {
  timeoutMs?: number
  intervalMs?: number
  label?: string
}

/**
 * Bounded polling helper. Use this instead of sleeping a fixed amount when a
 * queue, webhook or job is expected to settle.
 */
export async function waitFor<T>(
  check: () => Promise<T | undefined | false> | T | undefined | false,
  options: WaitForOptions = {}
): Promise<T> {
  const { timeoutMs = 20_000, intervalMs = 100, label = "condition" } = options

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const value = await check()

    if (value) return value

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`)
}
