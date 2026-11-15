export type JobLogMeta = Record<string, unknown>

export interface JobLogger {
  info(message: string, meta?: JobLogMeta): void
  error(message: string, error?: unknown, meta?: JobLogMeta): void
}

export const consoleJobLogger: JobLogger = {
  info(message, meta) {
    console.info(`[jobs] ${message}`, meta ?? "")
  },
  error(message, error, meta) {
    console.error(`[jobs] ${message}`, error ?? "", meta ?? "")
  },
}

/** Test double: keeps worker output out of the test report. */
export const silentJobLogger: JobLogger = {
  info() {},
  error() {},
}
