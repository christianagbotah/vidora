-- A reviewed Vidora cut includes the complete final audio performance.
-- narrationAccent and narrationStyle were added after the original audio review
-- trigger, so changing only those fields could leave a stale review valid.
-- Extend the database boundary to treat both as final-audio source inputs.

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
       AND OLD."narrationAccent" IS NOT DISTINCT FROM NEW."narrationAccent"
       AND OLD."narrationStyle" IS NOT DISTINCT FROM NEW."narrationStyle"
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
  "narrationAccent",
  "narrationStyle",
  "musicTrackUrl",
  "musicVolume"
ON "VideoScene"
FOR EACH ROW
EXECUTE FUNCTION vidora_video_cut_changed();
