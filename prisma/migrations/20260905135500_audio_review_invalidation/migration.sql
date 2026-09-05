-- A Vidora review covers the assembled experience, not only the ordered video
-- clips. Dialogue, speaker/voice choices, and scene music can all change the
-- final render without changing videoUrl. Extend the existing cut/review
-- version so those edits invalidate review and are frozen during active export.

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
      "finalVideoUrl" = NULL,
      "status" = CASE WHEN "status" = 'completed' THEN 'draft' ELSE "status" END
  WHERE "id" = affected_project_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "VideoScene_cut_review_guard" ON "VideoScene";
CREATE TRIGGER "VideoScene_cut_review_guard"
AFTER INSERT OR DELETE OR UPDATE OF
  "videoUrl",
  "sceneNumber",
  "projectId",
  "dialogue",
  "characterIds",
  "narrationVoice",
  "narrationLang",
  "musicTrackUrl",
  "musicVolume"
ON "VideoScene"
FOR EACH ROW
EXECUTE FUNCTION vidora_video_cut_changed();

-- Character name and voice participate in speaker-aware narration resolution.
-- Changing either one must invalidate a prior full-video review even though no
-- VideoScene row necessarily changes.
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
      "finalVideoUrl" = NULL,
      "status" = CASE WHEN "status" = 'completed' THEN 'draft' ELSE "status" END
  WHERE "id" = affected_project_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Character_audio_review_guard" ON "Character";
CREATE TRIGGER "Character_audio_review_guard"
AFTER INSERT OR DELETE OR UPDATE OF "name", "voiceId", "projectId"
ON "Character"
FOR EACH ROW
EXECUTE FUNCTION vidora_character_audio_changed();
