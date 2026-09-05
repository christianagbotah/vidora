-- Preserve the last completed clip while a scene is being regenerated.
-- This lets Vidora recover from a failed replacement without losing the
-- previously generated scene.
ALTER TABLE "VideoScene"
ADD COLUMN IF NOT EXISTS "previousVideoUrl" TEXT;
