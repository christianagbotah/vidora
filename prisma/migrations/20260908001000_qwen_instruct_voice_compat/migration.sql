-- Repair Qwen voice mappings after upgrading from qwen3-tts-flash to
-- qwen3-tts-instruct-flash. `Ryan` is a Flash voice but is not supported by
-- the Instruct model; `Bellona` is supported by both and is the closest
-- expressive character-oriented replacement for Vidora's `luodo` role.

DO $$
DECLARE
  qwen_active boolean;
  changed_count integer := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM "SystemConfig"
    WHERE "key" = 'ai_tts_provider' AND lower(btrim("value")) = 'qwen'
  ) INTO qwen_active;

  UPDATE "SystemConfig"
  SET "value" = replace(replace("value", '"Ryan"', '"Bellona"'), '"ryan"', '"Bellona"'),
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'qwen_tts_voice_map'
    AND ("value" LIKE '%"Ryan"%' OR "value" LIKE '%"ryan"%');

  GET DIAGNOSTICS changed_count = ROW_COUNT;

  IF qwen_active AND changed_count > 0 THEN
    UPDATE "VideoScene"
    SET "narrationUrl" = NULL
    WHERE "narrationUrl" IS NOT NULL;

    UPDATE "VideoProject"
    SET "reviewedCutVersion" = NULL,
        "reviewedAt" = NULL
    WHERE "reviewedCutVersion" IS NOT NULL OR "reviewedAt" IS NOT NULL;
  END IF;
END $$;
