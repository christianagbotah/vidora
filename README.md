# Vidora — AI Video Generation Studio

**Repository:** `github.com/christianagbotah/vidora`
**Production:** `https://vidora.lightworldtech.com`
**Prepared for:** Senior architecture & engineering review before production deployment

---

Vidora turns a plain-language idea — *"a birthday story for 5-year-old Giannis with his friends Chase and Marshall"* — into a finished, narrated, scored short video with consistent characters, per-character AI voices, on-screen text (e.g. "Happy Birthday Giannis" on the cake), background music, and one-click MP4 export. It is a full-stack SaaS: creative studio (frontend), generation pipeline (backend), token-based monetization, payment gateways (Ghana-first: Paystack/Hubtel + Stripe), and an admin portal with live pricing control and profit analytics.

All heavy AI lifting is delegated to the **Z.ai API platform** (video: CogVideoX-3 & Vidu families, images: GLM-Image, text: GLM-4.x, speech: TTS/ASR). Vidora owns orchestration, persistence, billing, and product UX.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Walkthrough (User-Facing Surface)](#2-product-walkthrough-user-facing-surface)
3. [Technology Stack](#3-technology-stack)
4. [System Architecture](#4-system-architecture)
5. [Data Model (Prisma)](#5-data-model-prisma)
6. [API Surface (83 endpoints)](#6-api-surface-83-endpoints)
7. [The AI Generation Pipeline (Core Engine)](#7-the-ai-generation-pipeline-core-engine)
8. [Z.ai Integration Layer](#8-zai-integration-layer)
9. [Token Economics & Billing](#9-token-economics--billing)
10. [Audio Pipeline](#10-audio-pipeline)
11. [Export Pipeline (ffmpeg)](#11-export-pipeline-ffmpeg)
12. [Security & Authentication](#12-security--authentication)
13. [Storage & Persistence Strategy](#13-storage--persistence-strategy)
14. [Deployment Topology](#14-deployment-topology)
15. [Reliability & Operational Concerns](#15-reliability--operational-concerns)
16. [Codebase Statistics & Layout](#16-codebase-statistics--layout)
17. [Known Limitations & Risks (Honest Assessment)](#17-known-limitations--risks-honest-assessment)
18. [Pre-Deployment Checklist](#18-pre-deployment-checklist)
19. [Recommended Roadmap](#19-recommended-roadmap)
20. [Appendix A — Key File Map](#appendix-a--key-file-map)
21. [Appendix B — Verified Z.ai Price Sheet](#appendix-b--verified-zai-price-sheet)

---

## 1. Executive Summary

| | |
|---|---|
| **What it is** | AI video generation SaaS (text/voice/video idea → finished short video) |
| **Target market** | Ghana + global; GHS-first pricing (GH₵), USD fallback |
| **Business model** | Prepaid token credits; users buy packages, each AI operation deducts tokens; per-operation real COGS (Z.ai API cost) is recorded for margin analytics |
| **Core differentiators** | Character consistency across scenes (reference-image video engines + per-character TTS voices), script intelligence (auto on-screen text, inscriptions, default music per occasion), full audio stack (narration + character voices + music + native clip ambience), background-job exports that survive CDN timeouts |
| **Monetization integrity** | Every spend writes a `TokenTransaction` with `costUsd` = the **official Z.ai list price**; admin sees live profit = revenue − COGS |
| **Size** | ~38,300 LOC TypeScript in `src/`, 83 API route files, 21 Prisma models |
| **Status** | Feature-complete for v1; deployed to production VPS behind Cloudflare; several scaling/refactor items before aggressive growth (see §17–18) |

**The golden path (what a paying user does):**

```
Idea (typed / spoken / video-analyzed)
  → LLM script split into scenes + characters + dialogue + on-screen text
  → Character portraits (GLM-Image, submit + poll)
  → Per-scene video clips (Z.ai video engine, submit + poll)
  → Audio: narration (TTS) + per-character voices + smart default music
  → Studio: reorder scenes, adjust music, preview full timeline
  → Export: background ffmpeg job → downloadable MP4 (720p→4K)
  → Optional: share page, translations/dubbing, brand-kit watermark
```

Every step above deducts tokens per the pricing table (§9) and refunds automatically on provider failure.

---

## 2. Product Walkthrough (User-Facing Surface)

The client is a single-page application (`src/app/page.tsx`) with 8 in-app views plus two public server-rendered routes. All user-visible content lives on `/`; view switching is client-side state (Zustand + local `AppView` union).

### In-app views (`AppView`)

| View | Purpose |
|---|---|
| `home` | Marketing landing: hero, template marketplace (DB-backed `ProjectTemplate`), pricing plans (`PricingPlan`, admin-editable), AI health badge |
| `create` | 3-step wizard: **(1)** Idea input — type, dictate (ASR), or upload reference video (VLM analysis); style/aspect/duration/engine pickers; AI prompt-enhance. **(2)** Script → scenes (LLM split), character editor, storyboard thumbnails. **(3)** Batch generation with live progress |
| `studio` | Project workspace: timeline of scenes, regenerate/reorder scenes, assign voices, pick music (6 tracks), narration, continuity checker, export dialog with quality presets, share/brand-kit controls |
| `gallery` | All user projects with status, final video preview |
| `dashboard` | Personal analytics: token balance, spend history, projects, previews used |
| `buy-tokens` | Storefront: token packages (`TokenPackage`, admin-editable), checkout via Paystack/Hubtel/Stripe |
| `profile` | Account settings |
| `admin` | Admin portal (role-gated): users, token packages, engine pricing, homepage plans, exchange rate, payments, profit analytics (revenue vs. Z.ai COGS), Z.ai credential config + live test-connection, contact inbox |

### Public routes

| Route | Purpose |
|---|---|
| `/share/[slug]` | Public share page for a finished video; optional bcrypt password; view analytics recorded (`VideoView`) |
| `/generated/[...path]` | Static asset server for generated clips/images/audio from `generated-store/` |
| `/api/*` | 83 API endpoints (§6) |

### Free preview funnel (customer acquisition)

Anonymous/logged-in users get daily-limited free previews (no tokens): 10 LLM storyboards + 3 watermarked style images per day (DB-tracked, resets at local midnight). Worst-case COGS ≈ $0.06/user/day at official Z.ai prices — bounded by `src/lib/preview-limit.ts`.

### Demo & assistant

- `/api/demo/create` provisions guest demo projects (template-based, no AI spend).
- `AIAssistant` component → `/api/assistant/chat` (LLM, rate-limited) for in-app creative help.

---

## 3. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16 (App Router)** + React 19 | All app logic in a single `/` route; API routes are the backend |
| Language | **TypeScript 5** (strict) | Zod 4 for runtime validation |
| Runtime | **Bun** (dev & build tooling); Node for PM2 prod process | Standalone output build |
| Styling | **Tailwind CSS 4** + **shadcn/ui (New York)** + Radix primitives | Light/dark via `next-themes` |
| State | **Zustand** (client), **TanStack Query 5** (server data) | |
| Animation | Framer Motion, ScrollReveal | |
| Database | **PostgreSQL** via **Prisma ORM 6** (prod) / SQLite mirror (dev sandbox) | See §13 for the schema-mirror mechanism |
| Auth | **NextAuth v4** (credentials provider, bcrypt, JWT sessions) | Role field `user` / `admin` |
| AI provider | **`z-ai-web-dev-sdk`** (server-side only) wrapped by `src/lib/zai.ts` | Env-driven `ZAI_API_KEY`, `ZAI_BASE_URL` |
| Payments | Paystack, Hubtel, Stripe | GHS primary; webhook-driven crediting with signature verification |
| Media processing | **ffmpeg / ffprobe** (`child_process`) | Export concat, transitions, audio mixing, watermarking |
| Process manager (prod) | **PM2** (1 instance, cluster mode, 1 GB memory cap) | |
| Reverse proxy | Webuzo/nginx (VPS) + Cloudflare (DNS/CDN/SSL) | 300 s proxy timeouts |
| Charts | Recharts (admin analytics) | |

---

## 4. System Architecture

### Production topology

```
                        ┌────────────────────────── Cloudflare (DNS/CDN/SSL)
                        │   https://vidora.lightworldtech.com
                        ▼
        Webuzo nginx custom vhost  (proxy_read_timeout 300s)
                        │
                        ▼
        PM2 → Node standalone server  (Next.js build, :3004, HOSTNAME=0.0.0.0)
        │        │            │             │
        │        │            │             └── generated-store/ (MP4s, images, audio)
        │        │            └── ffmpeg/ffprobe (export jobs, in-process)
        │        └── PostgreSQL (vidora_db)
        └── Z.ai API (api.z.ai) ─ video / image / LLM / TTS / ASR
                                   (submit + poll, billed per call)
```

Long operations (scene generation, export) **never** hold an HTTP request open. They run as in-process background jobs with DB-tracked progress (`ExportJob`, scene status fields) polled by the client — the fix for Cloudflare 524 gateway timeouts.

### Sandbox/dev topology (this environment)

```
Browser → Caddy gateway (:81, routes / → :3000; ?XTransformPort=N → :N)
        → bun run dev (Next dev server, :3000, logs to dev.log)
        → SQLite (db/custom.db) via prisma/schema.prisma.local mirror
```

### Architectural patterns

- **Server-only SDK boundary** — all Z.ai calls go through `src/lib/zai.ts`; never imported client-side.
- **Single mutation point for money** — `src/lib/tokens.ts` is the only code that changes `user.tokens` (atomic Prisma transaction + ledger row).
- **DB-backed configuration** — token packages, engine pricing, homepage plans, exchange rate, Z.ai credentials live in DB tables, editable from the admin portal without redeploys.
- **Background-job + poll** — for anything exceeding ~30 s.
- **Cost-tracked ledger** — every spend records real COGS; admin profit analytics reads it.
- **Soft-fail generation** — provider errors are classified (`src/lib/zai-errors.ts`) into user-friendly, actionable messages; failed ops auto-refund tokens.

---

## 5. Data Model (Prisma)

21 models in `prisma/schema.prisma` (PostgreSQL canonical; provider `postgresql`).

### Core content

| Model | Purpose | Key fields |
|---|---|---|
| `VideoProject` | One creative project | `status`, `style`, `aspectRatio`, `videoModel` (engine), `targetDuration`, `finalVideoUrl`, share fields (`shareSlug`, `isPublic`, `sharePassword`, `allowEmbed`), brand-kit & workspace FKs |
| `VideoScene` | One shot (≈5–10 s) of a project | `sceneNumber`, `prompt`, `enhancedPrompt`, `visualNote`, **`dialogue`**, `characterIds` (JSON), `referenceImageUrl`, `narrationUrl/voice`, mood/camera/lighting, `musicTrackUrl/volume`, subtitle fields (`subtitleSrt`, `burnSubtitles`, `subtitleLang`), dubbing (`narrationLang`), `imageUrl`, `videoUrl`, `taskId`, `status`, `errorMessage` |
| `Character` | Cross-scene consistent entity | `name`, `role`, `description`, `stylePrompt`, **`voiceId`** (TTS), `imageUrl` (AI portrait) |
| `SceneTranslation` | Per-scene dubbing track | `lang`, `translatedText`, `narrationUrl` (unique per scene+lang) |

### Money & monetization

| Model | Purpose |
|---|---|
| `User` | Auth + **`tokens` balance** + role + free-preview counters (`previewDate`, `previewStoryboardCount`, `previewImageCount`) |
| `Payment` | Gateway transactions (`paystack`/`hubtel`/`stripe`, amount, currency GHS/USD, `tokensPurchased`, status) |
| `TokenTransaction` | **The ledger**: `type` purchase/spend/refund/bonus, `amount` (±tokens), **`costUsd`** (real Z.ai COGS), `operationType` |
| `TokenPackage` | Admin-managed storefront packages (slug-stable, bonus %, sort, features) |
| `EnginePricing` | Admin-managed per-engine `tokensPerClip` + display prices |
| `PricingPlan` | Admin-managed homepage marketing cards |
| `SystemConfig` | KV config (Z.ai creds, exchange rate…) |

### Platform features

| Model | Purpose |
|---|---|
| `ExportJob` | Background export queue: `status` queued/running/done/failed, `progress`, `step`, `params` JSON, `result` JSON, `error` |
| `BrandKit` | Per-user branding: logo, position/opacity/scale, colors — applied at export (watermark) |
| `ProjectTemplate` | Template marketplace (scene/character templates as JSON, categories, usage counts) |
| `VideoView` | Share-page analytics (watch duration, completion, country) |
| `Workspace` / `WorkspaceMember` | Team spaces (owner/admin/editor/viewer) |
| `SocialConnection` / `SocialPublish` | OAuth connection storage + publish records (**publish is currently mocked — see §17**) |
| `GenerationHistory`, `ContactMessage` | Telemetry & contact inbox |

**Design note:** several 1:N structures (scene templates, character lists, plan features) are stored as JSON strings in `@db.Text` columns rather than normalized tables — pragmatic for admin-editable blobs, at the cost of relational integrity (acceptable trade-off, flagged for the reviewer).

---

## 6. API Surface (83 endpoints)

All under `/api/*` (App Router route handlers, Node runtime). `src/app/api/`:

| Domain | Endpoints | Notes |
|---|---|---|
| **Auth** | `auth/[...nextauth]`, `auth/register`, `auth/user`, `auth/forgot-password`, `auth/reset-password`, `auth/manual-session` | Credentials + bcrypt; manual-session is a dev-only fallback |
| **Projects CRUD** | `projects`, `projects/[id]`, `projects/[id]/scenes`, `scenes/[sceneId]`, `scenes/reorder`, `projects/[id]/characters`, `characters/[characterId]`, `characters/[characterId]/generate-image` | Full scene/character editing incl. `dialogue` persistence |
| **AI generation** | `split-scenes`, `enhance-prompt`, `enhance-scene`, `generate-scene`, `generate-video`, `generate-video-scene`, `generate-narration`, `generate-character-portrait` (+`/status`), `transcribe` (ASR), `analyze-video` (VLM), `check-continuity`, `video-status` | The pipeline (§7) |
| **Audio & music** | `audio/[filename]`, `scenes/[id]/music`, `music/tracks` | Generated audio storage + curated music library |
| **Subtitles & dubbing** | `scenes/[id]/subtitles`, `scenes/[id]/dubbing` | SRT generation + multi-language tracks |
| **Export & download** | `export-video`, `export-branded`, `concatenate-video`, `download/request`, `download/calculate-cost` | Background jobs (§11) |
| **Tokens & payments** | `tokens`, `tokens/history`, `payments/packages`, `payments/initialize`, `payments/verify`, `payments/webhook`, `payments/hubtel/status` | Ledger + 3 gateways; webhook signature verification |
| **Storefront** | `storefront/pricing` | Public pricing read (packages, engines, plans) |
| **Share & analytics** | `share/[slug]`, `share/[slug]/verify`, `projects/[id]/share`, `analytics/[projectId]`, `analytics/[projectId]/view`, `analytics/[projectId]/summary` | Public share + view tracking |
| **Templates & demo** | `templates`, `templates/[slug]/use`, `demo/templates`, `demo/create` | Marketplace + zero-cost guest demos |
| **Admin portal** | `admin/users` (+`[id]`), `admin/packages` (+`[id]`), `admin/plans` (+`[id]`), `admin/storefront`, `admin/exchange-rate`, `admin/analytics`, `admin/profit-analytics`, `admin/api-costs`, `admin/payments`, `admin/config` (+`seed`, `test-connection`) | Role-gated |
| **Misc** | `assistant/chat`, `contact`, `ai/health`, `brand-kit`, `social/publish`, `social/connections`, `preview/storyboard`, `preview/image`, `preview/usage` | |

**Conventions:** Zod validation on mutating routes; session or project-token authorization via `src/lib/project-auth.ts`; uniform JSON error envelope; friendly content-filter mapping for Z.ai safety refusals.

---

## 7. The AI Generation Pipeline (Core Engine)

The pipeline is orchestrated across five route handlers backed by shared libs. This is the heart of the product.

### Step 0 — Idea intake (`create` view)

- **Typed idea** → optional LLM prompt enhancement (`/api/enhance-prompt`, free — encourages starts).
- **Voice idea** → `/api/transcribe` (GLM-ASR-2512, ~$0.0024/min).
- **Reference video** → `/api/analyze-video` (VLM: GLM-4.6V) → structured scene brief.
- Template start (`/api/templates/[slug]/use`) — no AI cost.

### Step 1 — Script intelligence (`/api/split-scenes`, LLM)

A single LLM call converts the raw idea/script into a structured storyboard:

- Scene count derived from the user's script (honors explicit "Scene 1…Scene 6" formatting, no silent slicing), clamped by `targetDuration` (10 s/scene default).
- Per scene: `title`, visual prompt, `visualNote`, **`dialogue`** (extraction regex tolerates multi-speaker lines like `Chase & Marshall:`, `Everyone (sings):`, `Chorus:`), mood / camera / lighting / musicMood, duration, transition.
- Characters extracted with descriptions + auto-assigned TTS voices; group speakers (Chorus/Everyone) narrate without becoming bogus characters.
- **Celebration intelligence** (`src/lib/onscreen-text.ts`):
  - detects occasion (birthday / wedding / anniversary / graduation / new-baby / congratulations);
  - injects **inscription instructions** into every relevant scene prompt (cake icing, balloons, banner text — e.g. "Happy Birthday Giannis");
  - guarantees a **final screen** scene (title card with honoree name + date) if the script lacks one;
  - picks **smart default background music** per occasion (birthday→joyful, graduation→epic, baby→calm) from `public/music/`.

### Step 2 — Character portraits

`/api/generate-character-portrait` (+ `/status` polling): GLM-Image submit+poll per character; portraits persist to `generated-store/` and become reference images for consistency. (Vidu 2 Reference engine uses up to 7 refs to lock identity across scenes.)

### Step 3 — Scene generation (`/api/generate-video`)

For each scene (parallel task submission, guarded by a per-project **generation lock** to prevent double-charging):

1. **Prompt assembly** (`src/lib/image-prompt.ts`): merges scene prompt + character descriptors + style + on-screen text directives; builds both an image prompt (storyboard still) and a video prompt.
2. **Video task submit** (`zai.generateVideo`) — engine resolved via `resolveModelForRequest()` with smart substitution so requests never dead-end (e.g. `viduq1-image` without an image → `viduq1-text`; any vidu2 without image → CogVideoX-3).
3. **Token deduction** — engine-specific tokens/clip from `EnginePricing` (admin-controlled), COGS recorded.
4. **Poll** (`zai.pollVideoTask`) → on success, MP4 saved to `generated-store/`, `videoUrl` set, then **auto-narration** (`autoNarrateScene`) synthesizes scene TTS in the background.
5. **Failure handling**: Z.ai rate-limit → 2-minute cooldown then next scene (window-aware); content-filter → friendly per-scene error surfaced in UI; hard failure → **automatic token refund**.
6. **Thumbnails** generated in a parallel background pass (GLM-Image, 1 token) — never blocks task creation.

`/api/video-status` is the client's aggregate progress poller (ETA, per-scene states).

### Step 4 — Studio refinement

Scene reorder (dnd-kit), per-scene regenerate, music/voice assignment, continuity check (VLM compares last-frame → next-scene prompt), narration regeneration, subtitles (SRT), dubbing tracks.

### Step 5 — Export (§11) and share (§2).

### Failure taxonomy (`src/lib/zai-errors.ts`)

Provider errors are classified into kinds (auth, balance, rate-limit, content-filter, server, network, timeout) and rendered as actionable user messages — e.g. content-filter advises rewording a scene; balance errors deep-link to buy-tokens.

---

## 8. Z.ai Integration Layer

`src/lib/zai.ts` (~1,500 LOC) — the single server-side SDK boundary. Exposes typed wrappers with env-driven config (`ZAI_API_KEY`, `ZAI_BASE_URL`, `ZAI_CHAT_MODEL`), retry/backoff, and a `ZAIError` class with `ZAIErrorKind` classification:

| Function | Z.ai capability | Used by |
|---|---|---|
| `chat()` | GLM-4.x text (script split, enhance, assistant) | split-scenes, enhance-*, assistant |
| `vision()` | GLM-4.6V (video analysis, continuity) | analyze-video, check-continuity |
| `generateImage()` | GLM-Image / CogView-4 | thumbnails, portraits, previews |
| `generateVideo()` | **submit** async video task | scene generation, character portrait video |
| `pollVideoTask()` | poll task → result URL | all video flows |
| `tts()` | TTS voices | narration, character voices, dubbing |
| `asr()` | GLM-ASR-2512 | voice input |
| `cleanLLMOutput()` | strip markdown/fences from LLM JSON | robustness |

### Video engine catalog (`src/lib/video-models.ts`)

Single source of truth, mirrored client & server (dependency-free):

| Engine | Mode | Duration | Resolution | COGS/clip | Tokens/clip |
|---|---|---|---|---|---|
| **CogVideoX-3** *(default)* | text or image | 5/10 s | up to 4K | **$0.20** | 6 |
| viduq1-text | text | 5 s | 1080p | $0.40 | 12 |
| viduq1-image | image | 5 s | 1080p | $0.40 | 12 |
| vidu2-image | image | 4 s | 720p | $0.20 | 6 |
| vidu2-reference | 1–7 refs | 4 s | 720p | $0.40 | 12 |

Transport details per family are handled here (aspect-ratio param for Vidu vs. explicit pixel sizes for CogVideoX; `style: anime|general` for viduq1-text; start-end models deliberately excluded — pipeline can't supply first+last frames). Orientation is normalized (`src/lib/aspect-normalize.ts`): reference images are center-cropped to project aspect before submission so image-to-video engines don't emit mismatched orientations.

---

## 9. Token Economics & Billing

**This is the financial heart — recently audited and re-based on official Z.ai list prices** (owner observed ~$3 spend on one trial; reconciliation: 13 clips × $0.20 + portraits/LLM/TTS ≈ $2.85 — matches).

### Unit economics (`src/lib/pricing.ts`)

- **Token valuation:** 1 token = **$0.05 = GH₵ 0.50** baseline.
- **Video clip (CogVideoX-3):** charges 6 tokens ($0.30) vs. $0.20 COGS → **~33% gross margin**.
- **Image (GLM-Image):** 1 token ($0.05) vs. $0.015 → 70% margin.
- **LLM ops:** 0–1 tokens (prompt enhance free; scene split 1).
- **TTS/ASR:** 1 token each.
- **Download:** free (generation is the monetization point).

### Worked example — classic 45–60 s birthday video (6 scenes, default engine)

| Item | Tokens | COGS (Z.ai) |
|---|---|---|
| 6 video clips | 36 | $1.20 |
| 6 thumbnails | 6 | $0.09 |
| Scene split + TTS | ~2 | ~$0.007 |
| **Total** | **≈44** | **≈$1.30** |
| Revenue @ $0.05/token | $2.20 | — |
| **Gross margin** | **≈38%** | |

### Token packages (DB `TokenPackage`, admin-editable; mirror in `pricing.ts`)

| Package | Price | Tokens (+bonus) | Sized as |
|---|---|---|---|
| Starter | GH₵12 / $2.50 | 25 | one 30 s video |
| **Basic** *(popular)* | GH₵22 / $4.50 | 50 (+10% → 55) | one full 45–60 s video |
| Pro | GH₵42 / $8.50 | 110 (+20% → 132) | three 45–60 s videos |
| Business | GH₵84 / $17 | 240 (+25% → 300) | six videos, 4K |
| Enterprise | GH₵175 / $35 | 550 (+30% → 715) | sixteen videos, API access |

### Ledger & controls

- `src/lib/tokens.ts`: atomic check→deduct→record (Prisma transaction); **only** mutation point for balances; auto-refund on failed ops.
- `TokenTransaction.costUsd` enables `admin/profit-analytics` (revenue − real COGS, per operation type).
- `admin/api-costs` shows the live cost table from constants.
- Gateways: **Paystack** & **Stripe** webhooks HMAC-verified; **Hubtel** uses ResponseCode + ClientReference reconciliation (its API has no signature header — noted in code). Crediting is idempotent per payment reference.

---

## 10. Audio Pipeline

Four audio layers, mixed at export:

1. **Narration (TTS)** — `src/lib/narration.ts`: per-scene narration with voice selection; speaker labels are stripped from dialogue before synthesis (labels were causing robotic speech).
2. **Per-character voices** — each `Character.voiceId` maps to a distinct TTS voice; scene `dialogue` is synthesized per speaker (multi-speaker lines like `Chase & Marshall:` are split). Group lines (`Chorus:`, `Everyone (sings):`) are voiced, not dropped.
3. **Background music** — curated library `public/music/` (calm/dramatic/epic/joyful/mysterious/tense, m4a); per-scene `musicTrackUrl` + `musicVolume` (default 30%); smart default per occasion (§7).
4. **Native clip ambience** — Z.ai clips can carry generated sound; export mixes it at 0.6 volume under voices (1.0).

Auto-narration runs post-video-success (`autoNarrateScene`) so clips aren't waiting on TTS. Audio files persist to `generated-store/` and are served via `/api/audio/[filename]`.

---

## 11. Export Pipeline (ffmpeg)

`/api/export-video` — a **background job** pattern (the Cloudflare 524 fix):

- `ExportJob` row: queued → running (progress + human `step`) → done/failed.
- Client polls job status; UI shows live progress and download link when done.
- **Stale-job detection:** jobs heartbeat via `updatedAt`; >3 min silence (crash/restart) → surfaced as failed.
- Pipeline: normalize clips → optional title card → scene concat with **transitions** (fade/dissolve/slide/wipe via ffmpeg xfade) → **audio mux** (narration + character voices + music + ambience, per-layer volumes) → optional burned subtitles → optional brand-kit watermark (logo/opacity/position) → quality presets (720p draft CRF28 ultrafast → 4K ultra CRF15 veryslow) → final MP4 to `generated-store/` → `finalVideoUrl`.
- `/api/export-branded` — brand-kit variant; `/api/concatenate-video` — quick preview concat.
- Download is free (no tokens) — generation already paid.

---

## 12. Security & Authentication

| Concern | Implementation |
|---|---|
| Auth | NextAuth v4 credentials + bcrypt hashes; JWT sessions; `role` field gates admin routes (`src/lib/admin.ts`) |
| Passwords | bcrypt; reset flow via `auth/forgot-password` / `auth/reset-password` |
| Project access | `src/lib/project-auth.ts` — owner OR valid project share token; enforced on project-scoped routes |
| Share pages | Optional bcrypt password on `/share/[slug]`; `allowEmbed` flag |
| Input validation | Zod schemas on mutating endpoints |
| Rate limiting | In-memory per-IP limiter (`src/lib/rate-limit.ts`) on sensitive routes (auth, assistant, preview); DB-based daily preview caps per user |
| Payment integrity | Paystack/Stripe webhook signature verification; idempotent crediting |
| Secrets | `.env` only (gitignored); `.env.example` documents all vars; PM2 injects env; `admin/config` allows runtime Z.ai credential updates (DB-backed, masked) |
| SDK boundary | z-ai-web-dev-sdk imported only in server code |
| Content safety | Z.ai refusals mapped to friendly guidance (no raw provider dumps) |

**Known gaps → §17/§18:** in-memory limiter is per-process (single-instance assumption); sandbox runs a dev NEXTAUTH_SECRET fallback (prod must define a strong secret); no CSRF middleware beyond Next defaults; no automated pen-test.

---

## 13. Storage & Persistence Strategy

- **PostgreSQL** is canonical (all models). Sandbox dev uses **SQLite** (`db/custom.db`) via `scripts/local-db-push.sh`, which **temporarily swaps** `prisma/schema.prisma.local` (SQLite mirror) in, runs `prisma db push`, then restores the PostgreSQL schema — the committed schema never leaves the postgres state, and `deploy.sh` hard-verifies `provider = "postgresql"` before building.
- **`generated-store/`** — durable file store for all generated assets (MP4 clips, final exports, images, TTS audio) with DB-relative paths; served by `/generated/[...path]` and `/api/audio/[filename]`; assets are rewritten to **absolute origin URLs** when sent to Z.ai (provider must fetch them).
- **`upload/`** — user uploads (brand logos, reference images); `public/music/` — curated music; `public/` — static assets.
- Backups: not automated (see checklist §18).

---

## 14. Deployment Topology

### Production (VPS — lightworldtech)

- **deploy.sh** (run on VPS at `/home/lightworld/webapps/vidora`):
  1. `git pull origin main` → 2. verify schema is postgres (abort if not) → 3. `bun install --frozen-lockfile` → 4. `prisma generate` (+ optional `--db-push` flag for schema changes) → 5. `bun run build` (standalone bundle + static/prisma copy) → 6. `pm2 delete vidora && pm2 start ecosystem.config.js && pm2 save` (delete+start, not restart — avoids stale env) → 7. health checks: port bind, HTTP 200, `/api/ai/health`.
- **PM2**: 1 instance, cluster mode, `HOSTNAME=0.0.0.0` (binds all interfaces — the 502 fix behind Webuzo nginx), `PORT=3004`, `max_memory_restart: 1G`, logs to `logs/`.
- **nginx**: Webuzo custom vhost (`nginx-proxy.conf` → `/var/webuzo-data/nginx/custom/domains/`) with 300 s read/send timeouts — long polls survive.
- **Cloudflare** fronts the domain (SSL, CDN, DDoS); origin timeouts mitigated by the background-job architecture.
- **`/api/ai/health`** returns `ok | degraded | down` (probes Z.ai connectivity) — used by deploy verification and the homepage status badge.

### Sandbox (this environment)

`bun run dev` (Next dev, :3000, logs `dev.log`) behind a Caddy gateway (:81) that routes by port query (`?XTransformPort=N`) for auxiliary mini-services; SQLite local DB; seeded admin `admin@vidora.local`.

---

## 15. Reliability & Operational Concerns

- **Generation lock** per project prevents concurrent duplicate batches (and double charges).
- **Rate-limit cooldown** (2 min) on Z.ai 429s keeps batch generation resilient.
- **Auto-refund** on failed operations — user never loses tokens for provider failures.
- **Stale-job reaper** for exports (heartbeat) — crashed jobs become visible failures.
- **Error envelope + classification** end-to-end; the UI shows actionable errors (content-filter guidance, balance deep-links).
- **PM2 autorestart + 1 GB memory cap**; ffmpeg availability is checked at export time.
- **Observability:** PM2 logs, `dev.log`/`server.log` tee, admin analytics (usage, profit), `/api/ai/health`. No external APM/Sentry yet (checklist).

---

## 16. Codebase Statistics & Layout

```
src/
├── app/
│   ├── page.tsx               ← entire SPA (11,645 lines — see §17)
│   ├── layout.tsx, globals.css, preloader.css
│   ├── api/                   ← 83 route.ts files (§6)
│   ├── share/[slug]/          ← public share page
│   └── generated/[...path]/   ← asset server
├── components/                ← 14 app components + shadcn/ui (46 primitives)
│   (AIAssistant, BrandKitDialog, ShareDialog, DeviceSimulator,
│    Package/PlanEditDialog, ErrorBoundary, LoadingSkeletons, …)
├── lib/                       ← 26 modules (see Appendix A)
└── types/video.ts             ← shared domain types (VideoProject, Scene, AppView…)
```

- **~38,300 LOC** TypeScript in `src/` (plus `mini-services/`, `scripts/`).
- 21 Prisma models; 5 video engines; 6 music tracks; 6 quality presets.
- `page.tsx` alone: 11,645 lines, ~188 `useState` hooks — a deliberate v1 speed trade-off (§17).

Root also contains: `deploy.sh`, `ecosystem.config.js`, `nginx-proxy.conf` + `setup-nginx.sh`, `Caddyfile` (sandbox gateway), `scripts/` (DB helpers, pre-commit guard), `prisma/` (schema + `schema.prisma.local` mirror + `seed-admin.ts`), `.env.example`.

---

## 17. Known Limitations & Risks (Honest Assessment)

For the reviewing architect — the top items, ranked:

1. **Monolithic frontend** — `src/app/page.tsx` is 11.6 k lines (all 8 views). Works, shipped fast, but is the largest maintainability risk: poor code-splitting (bundle size), hard-to-test, merge-conflict hotspot. **Recommend phased decomposition into App Router routes + feature components** (§19).
2. **In-memory process state** — rate limiter, generation locks, preview counters (session-level) live in a single Node process. Fine at 1 PM2 instance; **breaks under horizontal scaling**. Needs Redis (or DB rows) before multi-instance.
3. **No automated test suite** — quality has been verified by end-to-end browser runs (agent-browser) and production trials, but there is no regression safety net. Highest-leverage pre-investment: pipeline unit tests (split-scenes parsing, pricing math, token ledger) + one happy-path E2E.
4. **TTS unit cost is estimated** (~$0.003/call) because Z.ai hasn't published TTS pricing; margins on audio ops are approximate. Reconcile against actual portal spend periodically (the `costUsd` ledger makes this easy).
5. **NEXTAUTH_SECRET dev fallback** — sandbox logs show a fallback secret warning; production `.env` defines a real one, but this must be verified strong & rotated before launch (checklist).
6. **Social publishing is mocked** — `social/publish` records DB rows with mock URLs; no real platform API uploads. Model & UI are ready; integration is future work. Present accordingly (don't advertise one-click publish yet).
7. **JSON-in-column patterns** (scene templates, character lists, plan features) — flexible but unvalidated at the DB layer; zod parses at the boundary only.
8. **Single-region file storage** — `generated-store/` is local disk on the VPS. No object storage (S3/R2) yet; backups and CDN offload are manual. Data-loss risk if the VPS dies unbacked.
9. **Database backups not automated** — PostgreSQL on the same VPS; `--db-push` uses `--accept-data-loss` (dev convenience) — production schema changes should move to `prisma migrate` + backup-first.
10. **Honest scope notes:** workspace/team features are modeled but lightly surfaced in UI; no email delivery wired (SMTP env present, contact form stores to DB); `mini-services/` is empty (no auxiliary services currently needed).

None of these block a controlled launch; items 1–3 (and 5) are the ones I'd gate "scale-up" on.

---

## 18. Pre-Deployment Checklist

**Security**
- [ ] Generate & set a strong `NEXTAUTH_SECRET` on the VPS (≥32 random chars; confirm no fallback warning in `pm2 logs vidora`).
- [ ] Confirm production Z.ai key is a **billable** key with spend alerts on the Z.ai portal.
- [ ] Verify Paystack/Stripe **webhook endpoints** registered in gateway dashboards (URL: `https://vidora.lightworldtech.com/api/payments/webhook`).
- [ ] Review admin portal exposure; consider IP allow-list or 2FA for admin accounts.
- [ ] Confirm CORS/`NEXTAUTH_URL`/`NEXT_PUBLIC_BASE_URL` all equal the production origin.

**Data**
- [ ] Set up automated PostgreSQL backups (pg_dump cron + offsite copy) **before** traffic.
- [ ] Snapshot/sync `generated-store/` (or migrate to object storage + CDN).
- [ ] Baseline `bun run lint` = 0 errors on CI (currently true).

**Ops**
- [ ] `pm2 save` + `pm2 startup` (boot persistence) verified on the VPS.
- [ ] Monitor: wire `/api/ai/health` to an uptime checker; watch `logs/pm2-error.log`.
- [ ] Load-test one concurrent batch generation (2 users × 6 scenes) to observe ffmpeg + poll load.
- [ ] Confirm exchange-rate & package prices in admin portal match the intended launch economics (GH₵ pricing is live-editable).

**Product**
- [ ] Hide/annotate social-publish buttons (mocked) or wire real APIs.
- [ ] First-run seeding: `bun run seed-admin` for the admin account; strong password.
- [ ] Re-verify the golden path in production (create → generate → export → download → share).

---

## 19. Recommended Roadmap

| Phase | Item | Why |
|---|---|---|
| 1 (pre-scale) | Split `page.tsx` into App Router routes (`/create`, `/studio`, `/gallery`, `/dashboard`, `/admin`) + feature components | Maintainability, code-splitting, testability |
| 1 | Redis-backed rate limiting & locks; or move locks to DB rows | Multi-instance readiness |
| 1 | Test harness: pricing/ledger/split-scenes unit tests + Playwright E2E golden path | Regression safety |
| 2 | Object storage (S3/R2/Backblaze) for `generated-store/` + CDN | Durability, origin offload, global latency |
| 2 | `prisma migrate` workflows + CI (lint/typecheck/test) + preview deploys | Team safety |
| 2 | Sentry (or similar) + structured logging (pino) | Production observability |
| 3 | Real social OAuth publishing (YouTube/TikTok/Instagram APIs) | Model & UI already exist |
| 3 | Storyboard-to-video upgrade path (image→video per scene on demand) | Cheaper drafts, paid upgrades |
| 3 | Team workspaces UI, dubbing expansion (more locales), template marketplace payouts | Growth features |

---

## Appendix A — Key File Map

| File | Role |
|---|---|
| `src/lib/zai.ts` | Z.ai SDK boundary: chat/vision/image/video(submit)/poll/tts/asr + error classification |
| `src/lib/pricing.ts` | **Pricing engine** — token costs, real COGS, packages, project cost calculator (audited vs. official Z.ai sheet) |
| `src/lib/tokens.ts` | Token ledger — atomic deduct/credit/refund + costUsd recording |
| `src/lib/storefront.ts` | DB-backed storefront seeds (packages, engines, plans) + engine charge info |
| `src/lib/video-models.ts` | Video engine catalog + transport constraints + smart substitution |
| `src/app/api/split-scenes/route.ts` | Script intelligence (LLM storyboard: scenes, characters, dialogue, on-screen text, default music) |
| `src/lib/onscreen-text.ts` | Occasion detection, inscription injection, final-screen guarantee, default music mapping |
| `src/app/api/generate-video/route.ts` | Batch scene generation (submit+poll, locks, cooldowns, refunds, auto-narration) |
| `src/lib/narration.ts` | TTS narration + per-character voice synthesis |
| `src/app/api/export-video/route.ts` | Background export jobs (ffmpeg concat, transitions, audio mux, quality presets, watermark) |
| `src/lib/generated-store.ts` | Generated-asset persistence + URL resolution |
| `src/lib/image-prompt.ts` | Scene→image/video prompt assembly (character fusion, on-screen text) |
| `src/lib/auth.ts`, `src/lib/admin.ts`, `src/lib/project-auth.ts` | Auth, roles, project access control |
| `src/lib/rate-limit.ts`, `src/lib/preview-limit.ts` | Abuse & free-preview cost control |
| `src/lib/zai-errors.ts` | Provider error → friendly message taxonomy |
| `src/app/page.tsx` | The entire SPA (§17 risk #1) |
| `prisma/schema.prisma` (+ `.local` mirror) | 21-model canonical schema (postgres) |
| `deploy.sh`, `ecosystem.config.js`, `nginx-proxy.conf` | Production deployment & process management |

## Appendix B — Verified Z.ai Price Sheet

Source: `docs.z.ai/guides/overview/pricing` + model guides (as embedded in `src/lib/pricing.ts`):

| Capability | Model | Official price |
|---|---|---|
| Video | CogVideoX-3 | **$0.20 / video** |
| Video | vidu2-image | $0.20 / video |
| Video | vidu2-reference / viduq1-text / viduq1-image | $0.40 / video |
| Image | GLM-Image | $0.015 / image |
| Image | CogView-4 | $0.01 / image |
| Text | GLM-4.6 / 4.5 | $0.60 / M in · $2.20 / M out |
| Text | GLM-4.5-Air | $0.20 / M in · $1.10 / M out |
| Text | GLM-4.5-Flash / 4.7-Flash | **Free** |
| Text | GLM-4.6V (vision) | $0.30 / M in · $0.90 / M out |
| ASR | GLM-ASR-2512 | $0.03 / MTok (≈$0.0024/min) |
| TTS | — | Not published; estimated ~$0.003/call (ledger tracks actuals for reconciliation) |

---

*Report generated from the repository at commit `68a01ad` (branch `main`). Questions/audit requests → issue on GitHub or the in-app contact form.*
