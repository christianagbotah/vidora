const fs = require('fs');

function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  return text.replace(from, to);
}

// ── API: explicit retry intent + safe held-run recovery ─────────────────────
const routePath = 'src/app/api/generate-video/route.ts';
let route = fs.readFileSync(routePath, 'utf8');
route = replaceOnce(
  route,
  'import { canAutoReconcileReferenceDownloadFailure } from "@/lib/generation-reconciliation";',
  'import {\n  canAutoReconcileReferenceDownloadFailure,\n  canRecoverHeldProviderRun,\n} from "@/lib/generation-reconciliation";',
  'reconciliation import',
);
route = replaceOnce(
  route,
  '    const { projectId } = await req.json();',
  '    const { projectId, retry = false } = await req.json();',
  'retry request body',
);

const helperMarker = '\nexport async function POST(req: NextRequest) {';
if (!route.includes('async function recoverHeldProviderRun(')) {
  const helper = `
async function recoverHeldProviderRun(opts: {
  run: {
    id: string;
    projectId: string;
    userId: string;
    sceneIds: string;
    targetSceneId: string | null;
    activeKey: string | null;
    status: string;
    totalTokens: number;
    chargeTransactionId: string | null;
    refundTransactionId: string | null;
    error: string | null;
  };
  project: {
    id: string;
    userId: string | null;
    scenes: Array<{
      id: string;
      status: string;
      taskId: string | null;
      videoUrl: string | null;
      errorMessage: string | null;
    }>;
  };
  userId: string;
}): Promise<{
  recovered: boolean;
  queueSceneIds?: string[];
  preserveTaskSceneIds?: string[];
  reason?: string;
}> {
  const { run, project, userId } = opts;
  if (run.projectId !== project.id || run.userId !== userId || project.userId !== userId) {
    return { recovered: false, reason: "Generation ownership is inconsistent." };
  }

  const safety = canRecoverHeldProviderRun(run, project.scenes);
  if (!safety.safe) {
    return { recovered: false, reason: safety.reason || "Generation cannot be safely resumed automatically." };
  }

  const recovered = await db.$transaction(async (tx) => {
    const held = await tx.generationRun.findUnique({
      where: { id: run.id },
      select: { activeKey: true, status: true, refundTransactionId: true },
    });
    if (
      !held ||
      held.activeKey !== run.activeKey ||
      held.status !== "needs_reconciliation" ||
      held.refundTransactionId
    ) {
      return false;
    }

    if (safety.queueSceneIds.length > 0) {
      await tx.videoScene.updateMany({
        where: {
          projectId: project.id,
          id: { in: safety.queueSceneIds },
          videoUrl: null,
        },
        data: { status: "queued", taskId: null, errorMessage: null },
      });
    }

    await tx.generationRun.update({
      where: { id: run.id },
      data: {
        status: safety.preserveTaskSceneIds.length > 0 ? "waiting_provider" : "running",
        error: run.error
          ? run.error + " [user retry: safely resumed with original Vidora token charge]"
          : "User retry: safely resumed with original Vidora token charge",
      },
    });
    await tx.videoProject.update({
      where: { id: project.id },
      data: { status: "generating" },
    });
    return true;
  });

  return recovered
    ? {
        recovered: true,
        queueSceneIds: safety.queueSceneIds,
        preserveTaskSceneIds: safety.preserveTaskSceneIds,
      }
    : { recovered: false, reason: "The generation hold changed while retrying. Refresh and try again." };
}
`;
  route = replaceOnce(route, helperMarker, helper + helperMarker, 'recovery helper insertion');
}

const activeStart = route.indexOf('    const activeKey = `project:${projectId}`;');
const activeEnd = route.indexOf('\n    const QUEUED_STALE_MS = 5 * 60_000;', activeStart);
if (activeStart < 0 || activeEnd < 0) throw new Error('active run block markers not found');
const newActiveBlock = `    const activeKey = \`project:\${projectId}\`;
    let previousChargeRefunded = false;
    const existingRun = await db.generationRun.findUnique({ where: { activeKey } });
    if (existingRun) {
      if (existingRun.status === "needs_reconciliation") {
        // First handle the narrow pre-submission reference-image failure. No
        // provider task exists in this case, so the old Vidora charge is
        // refunded exactly once before a fresh run is created and charged.
        const referenceResult = await reconcileSafeReferenceDownloadFailure({
          run: existingRun,
          project,
          userId,
        });
        if (referenceResult.reconciled) {
          previousChargeRefunded = true;
          project = await db.videoProject.findUnique({
            where: { id: projectId },
            include: {
              scenes: { orderBy: { sceneNumber: "asc" } },
              characters: { orderBy: { createdAt: "asc" } },
            },
          });
          if (!project) {
            return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
          }
        } else if (retry) {
          // For persisted provider task IDs, retry/resume the SAME GenerationRun
          // and reuse its original Vidora token charge. In-flight task IDs are
          // only polled; definitively failed task IDs are the only ones reset.
          const recovery = await recoverHeldProviderRun({
            run: existingRun,
            project,
            userId,
          });
          if (recovery.recovered) {
            const sceneCount = (recovery.queueSceneIds?.length || 0) +
              (recovery.preserveTaskSceneIds?.length || 0);
            return NextResponse.json({
              success: true,
              message: \`Resuming \${sceneCount} unfinished scene\${sceneCount === 1 ? "" : "s"}.\`,
              retrying: true,
              reusedOriginalCharge: true,
              tokensCharged: 0,
              generationRunId: existingRun.id,
              sceneCount,
            });
          }
          return NextResponse.json({
            success: false,
            error: "The previous generation attempt requires review before it can be retried safely.",
            reconciliationRequired: true,
            reason: recovery.reason || referenceResult.reason,
            generationRunId: existingRun.id,
          }, { status: 409 });
        } else {
          const recovery = canRecoverHeldProviderRun(existingRun, project.scenes);
          return NextResponse.json({
            success: false,
            error: recovery.safe
              ? "This generation was interrupted. Use Retry/Resume to continue the unfinished scenes safely."
              : "The previous generation attempt requires review before it can be retried safely.",
            retryAvailable: recovery.safe,
            reconciliationRequired: !recovery.safe,
            reason: recovery.reason || referenceResult.reason,
            generationRunId: existingRun.id,
          }, { status: 409 });
        }
      } else {
        return NextResponse.json({
          success: true,
          message: "Generation already in progress.",
          alreadyRunning: true,
          generationRunId: existingRun.id,
        });
      }
    }
`;
route = route.slice(0, activeStart) + newActiveBlock + route.slice(activeEnd);
route = replaceOnce(
  route,
  '      remainingTokens: deduction.remainingTokens,\n    });',
  '      remainingTokens: deduction.remainingTokens,\n      refundedAndRecharged: previousChargeRefunded || undefined,\n    });',
  'generation response billing metadata',
);
fs.writeFileSync(routePath, route);

// ── Worker: thumbnail failure must never strand real video task polling ─────
const workerPath = 'scripts/generation-worker.ts';
let worker = fs.readFileSync(workerPath, 'utf8');
worker = replaceOnce(
  worker,
  '  const queued = scenes.filter((scene) => scene.status === "queued" && !scene.taskId);\n  for (let index = 0; index < queued.length; index += 1) {',
  '  const queued = scenes.filter((scene) => scene.status === "queued" && !scene.taskId);\n  const newlySubmittedSceneIds = new Set<string>();\n  for (let index = 0; index < queued.length; index += 1) {',
  'newly submitted tracking',
);
worker = replaceOnce(
  worker,
  '      await submitSceneTask({ runId: run.id, scene, videoSize, origin, ctx });',
  '      await submitSceneTask({ runId: run.id, scene, videoSize, origin, ctx });\n      newlySubmittedSceneIds.add(scene.id);',
  'newly submitted scene mark',
);
const oldThumb = `  let thumbnailFailure = false;
  for (const scene of afterSubmission.filter((item) => !item.videoUrl && item.taskId)) {
    const ok = await ensureThumbnail({ runId: run.id, scene, thumbSize, ctx });
    if (!ok) thumbnailFailure = true;
  }
`;
const newThumb = `  // Thumbnail generation is auxiliary. Attempt it once for scenes submitted
  // in THIS claim, but never stop provider-video polling if it fails. Repeating
  // thumbnail attempts on every polling claim can also burn provider balance.
  for (const scene of afterSubmission.filter(
    (item) => newlySubmittedSceneIds.has(item.id) && !item.videoUrl && item.taskId && !item.imageUrl
  )) {
    await ensureThumbnail({ runId: run.id, scene, thumbSize, ctx });
  }
`;
worker = replaceOnce(worker, oldThumb, newThumb, 'thumbnail isolation');
worker = replaceOnce(worker, '  if (allVideosDone && !thumbnailFailure) {', '  if (allVideosDone) {', 'all videos completion');
const failureStart = worker.indexOf('  if (providerFailure || thumbnailFailure) {');
const failureEnd = worker.indexOf('\n  if (providerWaiting || finalScenes.some', failureStart);
if (failureStart < 0 || failureEnd < 0) throw new Error('provider failure block markers not found');
const newFailure = `  if (providerFailure) {
    await markReconciliation(
      run.id,
      project.id,
      "A submitted provider video task failed and requires reconciliation"
    );
    return;
  }
`;
worker = worker.slice(0, failureStart) + newFailure + worker.slice(failureEnd);
fs.writeFileSync(workerPath, worker);

// ── UI: retry through the durable API; never mutate scene statuses locally ─
const pagePath = 'src/app/page.tsx';
let page = fs.readFileSync(pagePath, 'utf8');
page = replaceOnce(
  page,
  '        hasPending && !isAnyGenerating && !isGenerating && !generationActive &&',
  '        hasPending && currentProject.status !== "failed" && !isAnyGenerating && !isGenerating && !generationActive &&',
  'failed-project auto generation guard',
);
page = replaceOnce(
  page,
  '    if (currentView !== "studio" || !currentProject || generationPhase !== "idle" || generationOverlayDismissed) return;\n    const FRESH_RUN_MS = 30 * 60_000;',
  '    if (currentView !== "studio" || !currentProject || generationPhase !== "idle" || generationOverlayDismissed) return;\n    if (currentProject.status === "failed") {\n      setGenerationPhase("failed");\n      return;\n    }\n    const FRESH_RUN_MS = 30 * 60_000;',
  'failed-project recovery overlay',
);

const retryStart = page.indexOf('  /* ── Retry failed scenes from the generation lock overlay ──');
const retryEnd = page.indexOf('\n  const handleGenerateSingle = async', retryStart);
if (retryStart < 0 || retryEnd < 0) throw new Error('retry handler markers not found');
const newRetry = `  /* ── Retry/resume the durable generation run ──
     The server owns reconciliation. The client must never clear task IDs or
     manually rewrite scene state because that can lose in-flight provider work. */
  const handleRetryFailedScenes = async () => {
    if (!currentProject || isGenerating) return;
    setGenerationOverlayDismissed(false);
    setGenerationPhase("starting");
    setIsGenerating(true);
    seenGeneratingRef.current = false;
    allTerminalSinceRef.current = null;
    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, retry: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setGenerationPhase("failed");
        toast({
          title: data.reconciliationRequired ? "Retry needs review" : "Retry failed",
          description: data.reason || getApiError(data, "Could not resume generation."),
          variant: "destructive",
        });
        return;
      }

      toast({
        title: data.alreadyRunning ? "Generation is already running" : "Retry started",
        description: data.reusedOriginalCharge
          ? "Unfinished scenes resumed with the original Vidora token charge — no additional Vidora tokens were deducted."
          : data.refundedAndRecharged
            ? "The earlier failed Vidora charge was refunded before this fresh retry charge."
            : data.message,
      });
      setGenerationStartedAt(Date.now());
      setGenerationPhase(data.alreadyDone ? "completed" : "generating");
      await refreshProject();
      if (!data.alreadyDone) setTimeout(refreshProject, 3000);
    } catch {
      setGenerationPhase("failed");
      toast({
        title: "Retry failed",
        description: "Could not resume generation. Your project and provider task IDs are still preserved.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };
`;
page = page.slice(0, retryStart) + newRetry + page.slice(retryEnd);

page = replaceOnce(
  page,
  '                    {completed > 0\n                      ? `${completed} of ${total} scene${total > 1 ? "s" : ""} completed — ${failed} failed`\n                      : `${failed} of ${total} scene${total > 1 ? "s" : ""} failed`}',
  '                    {completed > 0\n                      ? `${completed} of ${total} scene${total > 1 ? "s" : ""} completed${failed > 0 ? ` — ${failed} failed` : " — generation interrupted"}`\n                      : failed > 0\n                        ? `${failed} of ${total} scene${total > 1 ? "s" : ""} failed`\n                        : "Generation run interrupted"}',
  'failed overlay headline',
);
page = replaceOnce(
  page,
  '                      ? "Some scenes were flagged by the AI content filter — edit their prompts in the studio (Edit ✎ on the scene), then retry. Tokens for failed scenes were refunded."\n                      : "Failed scenes are retried with one click — tokens for failed scenes were refunded."}',
  '                      ? "Some scenes were flagged by the AI content filter — edit their prompts in the studio (Edit ✎ on the scene), then retry."\n                      : "Retry resumes only unfinished scenes. Confirmed provider failures reuse the original Vidora token charge; safe pre-submission failures are refunded before a fresh retry."}',
  'failed overlay billing copy',
);
page = replaceOnce(
  page,
  '{isRetrying ? "Retrying…" : "Retry Failed Scenes"}',
  '{isRetrying ? "Retrying…" : failed > 0 ? "Retry Failed Scenes" : "Resume Generation"}',
  'retry button label',
);
fs.writeFileSync(pagePath, page);

console.log('generation retry/billing UX patch applied');
