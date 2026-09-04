-- The social connection/publishing APIs are intentionally fail-closed until
-- real provider OAuth/upload integrations exist. Purge any mock or legacy
-- credentials so a dormant plaintext token cannot remain at rest or be
-- mistaken for a production-ready connection.
UPDATE "SocialConnection"
SET
  "accessToken" = NULL,
  "refreshToken" = NULL,
  "tokenExpiresAt" = NULL,
  "isConnected" = FALSE,
  "accountId" = NULL,
  "accountName" = NULL
WHERE
  "accessToken" IS NOT NULL
  OR "refreshToken" IS NOT NULL
  OR "tokenExpiresAt" IS NOT NULL
  OR "isConnected" = TRUE
  OR "accountId" IS NOT NULL
  OR "accountName" IS NOT NULL;
