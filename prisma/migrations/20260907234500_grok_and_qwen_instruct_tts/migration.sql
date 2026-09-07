-- Upgrade Vidora's active Qwen narration lane to the instruction-capable
-- qwen3-tts-instruct-flash model and register Grok-specific TTS settings with
-- the existing derived-audio invalidation trigger.

-- Grok is optional and is not activated by this migration. Seed only safe
-- provider defaults so selecting it later has a production-oriented narrator
-- and endpoint without requiring manual database setup.
INSERT INTO "SystemConfig" ("id", "key", "value", "description", "updatedAt")
VALUES
  (
    'cfg_grok_tts_base_v1',
    'grok_tts_base_url',
    'https://api.x.ai/v1',
    'Grok TTS API base URL',
    CURRENT_TIMESTAMP
  ),
  (
    'cfg_grok_tts_voice_v1',
    'grok_tts_default_voice',
    'orion',
    'Default Grok TTS narrator voice ID',
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO NOTHING;

DO $$
DECLARE
  qwen_active boolean;
  old_model text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "SystemConfig"
    WHERE "key" = 'ai_tts_provider' AND lower(btrim("value")) = 'qwen'
  ) INTO qwen_active;

  SELECT "value" INTO old_model
  FROM "SystemConfig"
  WHERE "key" = 'ai_tts_model';

  IF qwen_active AND (
    old_model IS NULL OR btrim(old_model) = '' OR
    lower(btrim(old_model)) = 'qwen3-tts-flash' OR
    lower(btrim(old_model)) ~ '^qwen3-tts-flash-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ) THEN
    INSERT INTO "SystemConfig" ("id", "key", "value", "description", "updatedAt")
    VALUES (
      'cfg_qwen_instruct_tts_v1',
      'ai_tts_model',
      'qwen3-tts-instruct-flash',
      'Optional TTS model override for the active provider',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("key") DO UPDATE
    SET "value" = EXCLUDED."value",
        "description" = EXCLUDED."description",
        "updatedAt" = CURRENT_TIMESTAMP;

    -- The provider/model changed even though scene dialogue did not. Discard
    -- only derived narration and review state; generated visual clips remain.
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
    'grok_tts_base_url',
    'grok_tts_default_voice',
    'grok_tts_voice_map',
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
