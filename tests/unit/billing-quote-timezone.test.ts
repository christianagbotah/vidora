import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function source(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

describe("BillingQuote absolute timestamp contract", () => {
  test("Prisma maps quote TTL timestamps to PostgreSQL timestamptz", () => {
    const schema = source("prisma", "schema.prisma");

    expect(schema).toContain('expiresAt        DateTime           @db.Timestamptz(3)');
    expect(schema).toContain('createdAt        DateTime           @default(now()) @db.Timestamptz(3)');
    expect(schema).toContain('updatedAt        DateTime           @updatedAt @db.Timestamptz(3)');
  });

  test("migration preserves existing instants using the production DB session timezone", () => {
    const migration = source(
      "prisma",
      "migrations",
      "20260911023000_billing_quote_timestamptz",
      "migration.sql",
    );

    expect(migration).toContain('ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3)');
    expect(migration).toContain('ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3)');
    expect(migration).toContain('ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3)');
    expect(migration.match(/AT TIME ZONE current_setting\('TimeZone'\)/g)?.length).toBe(3);
  });
});
