-- Full Preview now runs through the durable ExportJob queue (params.mode=preview).
-- The original review trigger predates preview jobs and treated every ExportJob
-- as a final export, creating a circular invariant: a cut had to be reviewed
-- before Vidora could create the job that builds the reviewable preview.
--
-- Keep the database boundary strict for final exports, but allow preview jobs to
-- start before review. Preview jobs still carry activeKey, so the existing cut
-- mutation guard continues to freeze the cut while a preview is queued/running.

CREATE OR REPLACE FUNCTION vidora_require_reviewed_cut_for_export()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_cut INTEGER;
  reviewed_cut INTEGER;
  job_mode TEXT := 'final';
BEGIN
  -- Old/final ExportJob rows may have NULL/legacy params. Treat anything that is
  -- not explicitly valid JSON with mode=preview as a final export so malformed
  -- callers can never bypass the review requirement.
  IF NEW."params" IS NOT NULL AND btrim(NEW."params") <> '' THEN
    BEGIN
      job_mode := lower(COALESCE((NEW."params"::jsonb)->>'mode', 'final'));
    EXCEPTION WHEN OTHERS THEN
      job_mode := 'final';
    END;
  END IF;

  IF job_mode = 'preview' THEN
    RETURN NEW;
  END IF;

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
