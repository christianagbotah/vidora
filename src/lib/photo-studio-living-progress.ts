export type LivingPhotoProgressStatus = "queued" | "running" | "done" | "failed";

export interface LivingPhotoProgressScene {
  status: string;
  videoUrl: string | null;
  errorMessage?: string | null;
}

export interface LivingPhotoProgressProject {
  status: string;
  scenes: LivingPhotoProgressScene[];
}

export interface LivingPhotoProgress {
  status: LivingPhotoProgressStatus;
  totalScenes: number;
  completedScenes: number;
  activeScenes: number;
  failedScenes: number;
  progress: number;
  step: string;
  error: string | null;
}

export function livingPhotoGenerationProgress(
  project: LivingPhotoProgressProject,
): LivingPhotoProgress {
  const totalScenes = project.scenes.length;
  const completedScenes = project.scenes.filter((scene) => Boolean(scene.videoUrl)).length;
  const activeScenes = project.scenes.filter(
    (scene) => !scene.videoUrl && (scene.status === "queued" || scene.status === "generating"),
  ).length;
  const failed = project.scenes.filter(
    (scene) => !scene.videoUrl && scene.status === "failed",
  );
  const failedScenes = failed.length;
  const done = totalScenes > 0 && completedScenes === totalScenes;
  const failedProject = project.status === "failed" || failedScenes > 0;
  const progress = done
    ? 100
    : totalScenes > 0
      ? Math.min(99, Math.round((completedScenes / totalScenes) * 100))
      : 0;

  if (done) {
    return {
      status: "done",
      totalScenes,
      completedScenes,
      activeScenes: 0,
      failedScenes: 0,
      progress,
      step: "AI motion clips are ready",
      error: null,
    };
  }

  if (failedProject) {
    const detail = failed.find((scene) => scene.errorMessage?.trim())?.errorMessage?.trim() || null;
    return {
      status: "failed",
      totalScenes,
      completedScenes,
      activeScenes,
      failedScenes,
      progress,
      step: "AI motion needs attention",
      error: detail,
    };
  }

  if (activeScenes > 0 || project.status === "generating") {
    return {
      status: "running",
      totalScenes,
      completedScenes,
      activeScenes,
      failedScenes: 0,
      progress,
      step: `Generating AI motion · ${completedScenes}/${totalScenes} scenes ready`,
      error: null,
    };
  }

  return {
    status: "queued",
    totalScenes,
    completedScenes,
    activeScenes: 0,
    failedScenes: 0,
    progress,
    step: "Preparing AI motion generation",
    error: null,
  };
}
