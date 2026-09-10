# Homepage credit packages + regeneration responsiveness

Release candidate based on production `c2e6e71e5072659392d67bbda81c39abbc46ce99`.

## Customer-facing changes

- Homepage pricing cards now come from the same active credit-package catalog used by Buy Credits.
- Homepage package prices are recalculated through the Billing v2 economic safety floor before display, matching checkout safety behavior.
- Package cards are one-time credit purchases and route customers to Buy Credits.
- Single-scene regeneration billing confirmation can resolve the active project even though the legacy scene-generation request body does not carry `projectId`.
- Targeted single-scene generation polls provider task status every 8 seconds by default instead of 15 seconds. Multi-scene polling and paid submission spacing remain unchanged.

## Safety invariants retained

- A confirmed Billing v2 quote is still required before paid generation.
- Provider model and quote-line matching remain exact and fail closed.
- No paid provider submission retry was added.
- Existing ambiguous/in-flight reconciliation protections remain unchanged.
- Multi-scene submission spacing remains 15 seconds by default.

## Release validation

The production deploy script remains the authoritative gate while account-level GitHub Actions are unavailable. It must pass provider preflight, Prisma validation, lint, TypeScript, unit tests, production build, backup/migration/runtime DB contract, PM2 health, durable worker heartbeats, HTTP health, and AI health before the release marker is advanced.
