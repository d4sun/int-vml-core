import { applyMigrations } from "./db"

export default function globalSetup(): void {
  applyMigrations()
}
