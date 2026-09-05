-- Bind a review to the content-affecting render choices that the user saw.
-- Encoding quality/container are intentionally excluded because they change
-- delivery quality, not story timing/audio/title content.
ALTER TABLE "VideoProject"
  ADD COLUMN IF NOT EXISTS "reviewedRenderConfig" JSONB;

-- Scene/audio invalidation now also clears the reviewed render configuration.
CREATE OR REPLACE FUNCTION vidora_video_cut_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_project_id TEXT;
  new_project_id TEXT;
  affected_project_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    affected_project_id := NEW."projectId";
  ELSIF TG_OP = 'DELETE' THEN
    affected_project_id := OLD."projectId";
  ELSE
    IF OLD."videoUrl" IS NOT DISTINCT FROM NEW."videoUrl"
       AND OLD."sceneNumber" IS NOT DISTINCT FROM NEW."sceneNumber"
       AND OLD."projectId" IS NOT DISTINCT FROM NEW."projectId"
       AND OLD."dialogue" IS NOT DISTINCT FROM NEW."dialogue"
       AND OLD."characterIds" IS NOT DISTINCT FROM NEW."characterIds"
       AND OLD."narrationVoice" IS NOT DISTINCT FROM NEW."narrationVoice"
       AND OLD."narrationLang" IS NOT DISTINCT FROM NEW."narrationLang"
       AND OLD."musicTrackUrl" IS NOT DISTINCT FROM NEW."musicTrackUrl"
       AND OLD."musicVolume" IS NOT DISTINCT FROM NEW."musicVolume" THEN
      RETURN NEW;
    END IF;

    old_project_id := OLD."projectId";
    new_project_id := NEW."projectId";
    affected_project_id := new_project_id;

    IF old_project_id IS DISTINCT FROM new_project_id THEN
      IF EXISTS (
        SELECT 1 FROM "ExportJob"
        WHERE "projectId" = old_project_id
          AND "activeKey" IS NOT NULL
          AND "status" IN ('queued', 'running')
      ) OR EXISTS (
        SELECT 1 FROM "ExportJob"
        WHERE "projectId" = new_project_id
          AND "activeKey" IS NOT NULL
          AND "status" IN ('queued', 'running')
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = 'P0001',
          MESSAGE = 'VIDORA_EXPORT_ACTIVE: the reviewed project render cannot change while an export is active';
      END IF;

      UPDATE "VideoProject"
      SET "cutVersion" = "cutVersion" + 1,
          "reviewedCutVersion" = NULL,
          "reviewedAt" = NULL,
          "reviewedRenderConfig" = NULL,
          "finalVideoUrl" = NULL,
          "status" = CASE WHEN "status" = 'completed' THEN 'draft' ELSE "status" END
      WHERE "id" IN (old_project_id, new_project_id);
      RETURN NEW;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "ExportJob"
    WHERE "projectId" = affected_project_id
      AND "activeKey" IS NOT NULL
      AND "status" IN ('queued', 'running')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'VIDORA_EXPORT_ACTIVE: the reviewed project render cannot change while an export is active';
  END IF;

  UPDATE "VideoProject"
  SET "cutVersion" = "cutVersion" + 1,
      "reviewedCutVersion" = NULL,
      "reviewedAt" = NULL,
      "reviewedRenderConfig" = NULL,
      "finalVideoUrl" = NULL,
      "status" = CASE WHEN "status" = 'completed' THEN 'draft' ELSE "status" END
  WHERE "id" = affected_project_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION vidora_character_audio_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_project_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    affected_project_id := NEW."projectId";
  ELSIF TG_OP = 'DELETE' THEN
    affected_project_id := OLD."projectId";
  ELSE
    IF OLD."name" IS NOT DISTINCT FROM NEW."name"
       AND OLD."voiceId" IS NOT DISTINCT FROM NEW."voiceId"
       AND OLD."projectId" IS NOT DISTINCT FROM NEW."projectId" THEN
      RETURN NEW;
    END IF;
    affected_project_id := NEW."projectId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM "ExportJob"
    WHERE "projectId" = affected_project_id
      AND "activeKey" IS NOT NULL
      AND "status" IN ('queued', 'running')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'VIDORA_EXPORT_ACTIVE: character voice identity cannot change while an export is active';
  END IF;

  UPDATE "VideoProject"
  SET "cutVersion" = "cutVersion" + 1,
      "reviewedCutVersion" = NULL,
      "reviewedAt" = NULL,
      "reviewedRenderConfig" = NULL,
      "finalVideoUrl" = NULL,
      "status" = CASE WHEN "status" = 'completed' THEN 'draft' ELSE "status" END
  WHERE "id" = affected_project_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Project title participates in the render whenever the title-card option is
-- enabled. Invalidate conservatively on every real title change so a stale
-- title can never be approved/exported through another caller.
CREATE OR REPLACE FUNCTION vidora_project_title_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."title" IS NOT DISTINCT FROM NEW."title" THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM "ExportJob"
    WHERE "projectId" = NEW."id"
      AND "activeKey" IS NOT NULL
      AND "status" IN ('queued', 'running')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'VIDORA_EXPORT_ACTIVE: the project title cannot change while an export is active';
  END IF;

  NEW."cutVersion" := NEW."cutVersion" + 1;
  NEW."reviewedCutVersion" := NULL;
  NEW."reviewedAt" := NULL;
  NEW."reviewedRenderConfig" := NULL;
  NEW."finalVideoUrl" := NULL;
  IF NEW."status" = 'completed' THEN NEW."status" := 'draft'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "VideoProject_title_review_guard" ON "VideoProject";
CREATE TRIGGER "VideoProject_title_review_guard"
BEFORE UPDATE OF "title" ON "VideoProject"
FOR EACH ROW
EXECUTE FUNCTION vidora_project_title_changed();

-- Export jobs must match both the reviewed project version and the exact
-- content-affecting settings shown in the preview.
CREATE OR REPLACE FUNCTION vidora_require_reviewed_cut_for_export()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_cut INTEGER;
  reviewed_cut INTEGER;
  reviewed_config JSONB;
  params_json JSONB;
  requested_config JSONB;
BEGIN
  SELECT "cutVersion", "reviewedCutVersion", "reviewedRenderConfig"
  INTO current_cut, reviewed_cut, reviewed_config
  FROM "VideoProject"
  WHERE "id" = NEW."projectId";

  IF reviewed_cut IS NULL OR reviewed_cut <> current_cut THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'VIDORA_PREVIEW_REQUIRED: build and review the current full-video preview before exporting';
  END IF;

  BEGIN
    params_json := COALESCE(NULLIF(NEW."params", '')::JSONB, '{}'::JSONB);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'VIDORA_PREVIEW_REQUIRED: export settings are invalid and must be previewed again';
  END;

  requested_config := jsonb_build_object(
    'transition', COALESCE(params_json->>'transition', 'fade'),
    'withTitleCard', COALESCE((params_json->>'withTitleCard')::BOOLEAN, FALSE),
    'includeAudio', COALESCE((params_json->>'includeAudio')::BOOLEAN, TRUE)
  );

  IF reviewed_config IS NULL OR reviewed_config <> requested_config THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'VIDORA_PREVIEW_REQUIRED: export content settings differ from the reviewed full-video preview';
  END IF;

  RETURN NEW;
END;
$$;

-- Existing trigger name is retained; replacing its function upgrades every
-- current/future ExportJob caller without a route-specific dependency.
DROP TRIGGER IF EXISTS "ExportJob_reviewed_cut_guard" ON "ExportJob";
CREATE TRIGGER "ExportJob_reviewed_cut_guard"
BEFORE INSERT ON "ExportJob"
FOR EACH ROW
EXECUTE FUNCTION vidora_require_reviewed_cut_for_export();
