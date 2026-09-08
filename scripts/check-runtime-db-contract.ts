import { db } from "../src/lib/db";

interface ColumnRow {
  column_name: string;
}

interface IndexRow {
  indexname: string;
  indexdef: string;
}

async function main(): Promise<void> {
  const columns = await db.$queryRaw<ColumnRow[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ExportJob'
      AND column_name IN ('activeKey', 'params', 'status', 'updatedAt')
  `;
  const columnNames = new Set(columns.map((row) => row.column_name));
  const requiredColumns = ['activeKey', 'params', 'status', 'updatedAt'];
  const missingColumns = requiredColumns.filter((name) => !columnNames.has(name));
  if (missingColumns.length) {
    throw new Error(
      `Runtime DB contract failed: ExportJob is missing column(s): ${missingColumns.join(', ')}`,
    );
  }

  const indexes = await db.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'ExportJob'
  `;
  const activeKeyUnique = indexes.some((row) => {
    const normalized = row.indexdef.replace(/\s+/g, ' ').toLowerCase();
    return normalized.includes('create unique index') && normalized.includes('("activekey")');
  });
  if (!activeKeyUnique) {
    throw new Error(
      'Runtime DB contract failed: ExportJob.activeKey does not have the required unique index',
    );
  }

  console.log('Runtime DB contract: OK (ExportJob durable media-job lock verified)');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
