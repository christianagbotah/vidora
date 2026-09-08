-- Repair migration/schema drift for the durable media-job lock used by
-- full preview and final export. The Prisma schema and application code require
-- ExportJob.activeKey, but the pre-hardening baseline created ExportJob without
-- this column and no subsequent migration added it.

ALTER TABLE "ExportJob"
ADD COLUMN IF NOT EXISTS "activeKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ExportJob_activeKey_key"
ON "ExportJob"("activeKey");
