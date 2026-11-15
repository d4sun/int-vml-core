import { getConstructionPlans } from "pg-boss"
import { JOBS_SCHEMA } from "../lib/jobs/config"

// Prints the pg-boss schema SQL so it can be committed as a Prisma migration.
// Usage: pnpm jobs:plans > prisma/migrations/<timestamp>_pg_boss/migration.sql
process.stdout.write(getConstructionPlans(JOBS_SCHEMA))
