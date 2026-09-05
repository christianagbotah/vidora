-- Align PostgreSQL defaults with the Prisma datamodel.
-- Prisma manages @updatedAt values in application writes, so database-level
-- CURRENT_TIMESTAMP defaults are unnecessary and appear as schema drift.

ALTER TABLE "GenerationRun"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "VideoScene"
  ALTER COLUMN "updatedAt" DROP DEFAULT;
