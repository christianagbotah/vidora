-- Character-aware narration casting for Qwen3-TTS.
--
-- 1. Give Qwen a provider-native default mapping for Vidora's logical voices.
-- 2. Backfill legacy characters that never received a voice assignment.
-- 3. Invalidate cached narration/review when global TTS routing changes so
--    old single-narrator audio can never be silently reused.

INSERT INTO "SystemConfig" ("id", "key", "value", "description", "updatedAt")
VALUES (
  'cfg_qwen_character_voice_map_v1',
  'qwen_tts_voice_map',
  '{"tongtong":"Cherry","chuichui":"Pip","luodo":"Ryan","kazi":"Ethan","douji":"Serena","xiaochen":"Neil","jam":"Eldric Sage"}',
  'JSON map from Vidora logical voice/profile keys to Qwen3-TTS voice names',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE
SET
  "value" = EXCLUDED."value",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP
WHERE btrim("SystemConfig"."value") = '' OR btrim("SystemConfig"."value") = '{}';

-- Older/manual characters may predate automatic Voice Studio casting. Narrator
-- identities remain on the narrator voice; other characters receive a stable
-- project-local palette assignment. Existing explicit assignments are never
-- overwritten.
WITH missing AS (
  SELECT
    c."id",
    c."projectId",
    c."name",
    c."role",
    row_number() OVER (
      PARTITION BY c."projectId"
      ORDER BY c."createdAt" ASC, c."id" ASC
    ) AS rn
  FROM "Character" c
  WHERE c."voiceId" IS NULL OR btrim(c."voiceId") = ''
)
UPDATE "Character" c
SET "voiceId" = CASE
  WHEN lower(coalesce(m."name", '')) LIKE '%narrator%'
    OR lower(coalesce(m."role", '')) = 'narrator'
    THEN 'tongtong'
  ELSE (ARRAY['chuichui','luodo','kazi','douji','xiaochen','jam']::text[])[((m.rn - 1) % 6) + 1]
END
FROM missing m
WHERE c."id" = m."id";

-- The mapping changes provider-native audio even though the logical voice ID
-- stored on a scene/character is unchanged. Clear derived narration and review
-- only when Qwen is the active TTS provider so the next preview/export creates
-- fresh multi-voice audio.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SystemConfig"
    WHERE "key" = 'ai_tts_provider' AND lower(btrim("value")) = 'qwen'
  ) THEN
    UPDATE "VideoScene"
    SET "narrationUrl" = NULL
    WHERE "narrationUrl" IS NOT NULL;

    UPDATE "VideoProject"
    SET "reviewedCutVersion" = NULL,
        "reviewedAt" = NULL
    WHERE "reviewedCutVersion" IS NOT NULL OR "reviewedAt" IS NOT NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION vidora_invalidate_tts_derived_audio()
RETURNS trigger AS $$
BEGIN
  IF NEW."key" IN (
    'ai_tts_provider',
    'ai_tts_model',
    'qwen_tts_default_voice',
    'qwen_tts_voice_map',
    'elevenlabs_default_voice_id',
    'elevenlabs_voice_map',
    'elevenlabs_tts_model',
    'zai_tts_base_url'
  ) AND (TG_OP = 'INSERT' OR OLD."value" IS DISTINCT FROM NEW."value") THEN
    IF EXISTS (
      SELECT 1
      FROM "ExportJob"
      WHERE "activeKey" IS NOT NULL AND "status" IN ('queued', 'running')
    ) THEN
      RAISE EXCEPTION 'VIDORA_EXPORT_ACTIVE: TTS configuration cannot change while a preview/export job is active';
    END IF;

    UPDATE "VideoScene"
    SET "narrationUrl" = NULL
    WHERE "narrationUrl" IS NOT NULL;

    UPDATE "VideoProject"
    SET "reviewedCutVersion" = NULL,
        "reviewedAt" = NULL
    WHERE "reviewedCutVersion" IS NOT NULL OR "reviewedAt" IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "SystemConfig_tts_derived_audio_invalidate" ON "SystemConfig";
CREATE TRIGGER "SystemConfig_tts_derived_audio_invalidate"
AFTER INSERT OR UPDATE OF "value" ON "SystemConfig"
FOR EACH ROW
EXECUTE FUNCTION vidora_invalidate_tts_derived_audio();
