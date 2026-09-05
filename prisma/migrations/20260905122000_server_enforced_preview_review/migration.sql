-- Persist which ordered scene cut the user most recently previewed and enforce
-- that invariant at the database boundary. This protects every export caller,
-- including direct API requests and stale browser tabs.

ALTER TABLE "VideoProject"
  ADD COLUMN IF NOT EXISTS "cutVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reviewedCutVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);

-- Any change that can alter the assembled visual cut invalidates the review.
-- Prompt-only edits intentionally do not invalidate the review until they are
-- regenerated into a different clip.
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
       AND OLD."projectId" IS NOT DISTINCT FROM NEW."projectId" THEN
      RETURN NEW;
    END IF;

    old_project_id := OLD."projectId";
    new_project_id := NEW."projectId";
    affected_project_id := new_project_id;

    -- Moving a scene between projects is not a normal Vidora workflow, but if
    -- it ever occurs both cuts must be invalidated.
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
          MESSAGE = 'VIDORA_EXPORT_ACTIVE: the video cut cannot change while an export is active';
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
      MESSAGE = 'VIDORA_EXPORT_ACTIVE: the video cut cannot change while an export is active';
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
AFTER INSERT OR DELETE OR UPDATE OF "videoUrl", "sceneNumber", "projectId"
ON "VideoScene"
FOR EACH ROW
EXECUTE FUNCTION vidora_video_cut_changed();

-- Export jobs are durable and may be created from more than one HTTP caller.
-- Require a current review at insertion time instead of trusting browser state.
CREATE OR REPLACE FUNCTION vidora_require_reviewed_cut_for_export()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_cut INTEGER;
  reviewed_cut INTEGER;
BEGIN
  SELECT "cutVersion", "reviewedCutVersion"
  INTO current_cut, reviewed_cut
  FROM "VideoProject"
  WHERE "id" = NEW."projectId";

  IF reviewed_cut IS NULL OR reviewed_cut <> current_cut THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'VIDORA_PREVIEW_REQUIRED: build and review the current full-video preview before exporting';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ExportJob_reviewed_cut_guard" ON "ExportJob";
CREATE TRIGGER "ExportJob_reviewed_cut_guard"
BEFORE INSERT ON "ExportJob"
FOR EACH ROW
EXECUTE FUNCTION vidora_require_reviewed_cut_for_export();

-- Legacy/direct concatenation paths can write finalVideoUrl without creating an
-- ExportJob. Guard finalization too so there is no alternate bypass.
CREATE OR REPLACE FUNCTION vidora_require_reviewed_cut_for_final_video()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."finalVideoUrl" IS DISTINCT FROM OLD."finalVideoUrl"
     AND NEW."finalVideoUrl" IS NOT NULL
     AND (NEW."reviewedCutVersion" IS NULL OR NEW."reviewedCutVersion" <> NEW."cutVersion") THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'VIDORA_PREVIEW_REQUIRED: the current cut must be reviewed before it can become the final video';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "VideoProject_final_video_review_guard" ON "VideoProject";
CREATE TRIGGER "VideoProject_final_video_review_guard"
BEFORE UPDATE OF "finalVideoUrl" ON "VideoProject"
FOR EACH ROW
EXECUTE FUNCTION vidora_require_reviewed_cut_for_final_video();
