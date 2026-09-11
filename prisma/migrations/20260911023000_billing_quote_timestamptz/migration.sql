-- BillingQuote timestamps are absolute instants and must not depend on the
-- PostgreSQL session timezone when they are deserialized into JavaScript Date.
--
-- Existing values were written into TIMESTAMP WITHOUT TIME ZONE columns while
-- the production database session timezone was America/Toronto. Interpret each
-- stored wall-clock value in the current database timezone before converting it
-- to timestamptz so existing quote TTLs preserve their real instant.

ALTER TABLE "BillingQuote"
  ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3)
    USING "expiresAt" AT TIME ZONE current_setting('TimeZone'),
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3)
    USING "createdAt" AT TIME ZONE current_setting('TimeZone'),
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3)
    USING "updatedAt" AT TIME ZONE current_setting('TimeZone');
