-- Persist whole-video Voice Studio defaults on the project itself so scenes
-- created after a bulk profile change inherit the intended narration profile.
-- Nullable columns preserve legacy behavior for projects that have never saved
-- an explicit whole-video Voice Studio profile.

ALTER TABLE "VideoProject"
  ADD COLUMN "narrationLang" TEXT,
  ADD COLUMN "narrationAccent" TEXT,
  ADD COLUMN "narrationStyle" TEXT,
  ADD COLUMN "narrationVoice" TEXT;
