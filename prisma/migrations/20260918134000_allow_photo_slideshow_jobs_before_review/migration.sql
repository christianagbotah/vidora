-- Photo Studio slideshow rendering is a pre-review media preparation job.
-- It must be queueable before Full Preview exists, but every unknown/malformed
-- mode still fails closed to final-export semantics.
CREATE OR REPLACE FUNCTION vidora_require_reviewed_cut_for_export()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_cut INTEGER;
  reviewed_cut INTEGER;
  job_mode TEXT := 'final';
BEGIN
  IF NEW."params" IS NOT NULL AND btrim(NEW."params") <> '' THEN
    BEGIN
      job_mode := lower(COALESCE((NEW."params"::jsonb)->>'mode', 'final'));
    EXCEPTION WHEN OTHERS THEN
      job_mode := 'final';
    END;
  END IF;

  IF job_mode IN ('preview', 'photo_slideshow') THEN
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
