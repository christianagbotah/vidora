import crypto from "crypto";

export type PhotoSlideshowMotion = "gentle_zoom" | "drift_left" | "drift_right" | "drift_up";

export interface PhotoSlideshowSourceScene {
  id: string;
  sceneNumber: number;
  referenceImageUrl: string | null;
  imageUrl: string | null;
  duration: number;
  transition: string;
}

export function photoSlideshowSourceUrl(scene: PhotoSlideshowSourceScene): string | null {
  return scene.referenceImageUrl || scene.imageUrl || null;
}

export function photoSlideshowSourceSignature(input: {
  projectId: string;
  aspectRatio: string;
  scenes: PhotoSlideshowSourceScene[];
}): string {
  const normalized = {
    projectId: input.projectId,
    aspectRatio: input.aspectRatio,
    scenes: input.scenes.map((scene) => ({
      id: scene.id,
      sceneNumber: scene.sceneNumber,
      source: photoSlideshowSourceUrl(scene),
      duration: scene.duration,
      transition: scene.transition,
    })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function slideshowCanvas(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case "9:16": return { width: 720, height: 1280 };
    case "1:1": return { width: 1080, height: 1080 };
    case "4:3": return { width: 960, height: 720 };
    case "21:9": return { width: 1260, height: 540 };
    case "16:9":
    default:
      return { width: 1280, height: 720 };
  }
}

export function slideshowMotionForIndex(index: number): PhotoSlideshowMotion {
  const sequence: PhotoSlideshowMotion[] = ["gentle_zoom", "drift_right", "drift_left", "drift_up"];
  return sequence[Math.abs(index) % sequence.length];
}

export function slideshowVideoFilter(
  aspectRatio: string,
  durationSeconds: number,
  motion: PhotoSlideshowMotion,
): string {
  const { width, height } = slideshowCanvas(aspectRatio);
  const frames = Math.max(72, Math.round(Math.max(3, durationSeconds) * 24));
  const base = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;

  if (motion === "drift_right") {
    return `${base},zoompan=z='1.08':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=24,format=yuv420p`;
  }
  if (motion === "drift_left") {
    return `${base},zoompan=z='1.08':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=24,format=yuv420p`;
  }
  if (motion === "drift_up") {
    return `${base},zoompan=z='1.07':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-on/${frames})':d=1:s=${width}x${height}:fps=24,format=yuv420p`;
  }
  return `${base},zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=24,format=yuv420p`;
}
