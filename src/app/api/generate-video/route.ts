import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { checkTokens, deductTokensForOperation, refundTokens } from "@/lib/tokens";
import { PRICING } from "@/lib/pricing";
import { getEngineChargeInfo } from "@/lib/storefront";
import { resolveModelForRequest } from "@/lib/video-models";
import {
  canAutoReconcileReferenceDownloadFailure,
  canRecoverHeldProviderRun,
} from "@/lib/generation-reconciliation";

export const runtime = "nodejs";

function hasProviderReference(
  scene: { referenceImageUrl: string | null; characterIds: string | null },
  characters: Array<{ id: string; imageUrl: string | null }>
): boolean {
  if (scene.referenceImageUrl && !scene.referenceImageUrl.startsWith("data:")) {
    return true;
  }
  if (!scene.characterIds) return false;
  try {
    const parsed: unknown = JSON.parse(scene.characterIds);
    if (!Array.isArray(parsed)) return false;
    const ids = new Set(parsed.filter((id): id is string => typeof id === "string"));
    return characters.some(
      (character) =>
        ids.has(character.id) &&
        Boolean(character.imageUrl) &&
        !character.imageUrl!.startsWith("data:")
    );
  } catch {
    return false;
  }
}

async function reconcileSafeReferenceDownloadFailure(opts: {
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
}): Promise<{ reconciled: boolean; reason?: string }> {
  const { run, project, userId } = opts;
  if (run.projectId !== project.id || run.userId !== userId || project.userId !== userId) {
    return { reconciled: false, reason: "Generation ownership is inconsistent." };
  }

  const safety = canAutoReconcileReferenceDownloadFailure(run, project.scenes);
  if (!safety.safe) {
    return { reconciled: false, reason: safety.reason || "Generation cannot be safely retried automatically." };
  }

  let refundTransactionId = run.refundTransactionId;
  if (run.totalTokens > 0 && !refundTransactionId) {
    if (!run.chargeTransactionId) {
      return { reconciled: false, reason: "The previous generation charge could not be verified." };
    }
    const refund = await refundTokens({
      userId,
      amount: run.totalTokens,
      description: `Automatic refund for generation run ${run.id}: reference image download failed before provider task creation`,
      referenceId: project.id,
      operation: "video_gen",
      idempotencyKey: `generation:${run.id}:refund`,
      relatedTransactionId: run.chargeTransactionId,
    });
    if (!refund.success) {
      return { reconciled: false, reason: "The previous generation charge could not be refunded safely." };
    }
    refundTransactionId = refund.transactionId || null;
  }

  await db.$transaction(async (tx) => {
    // Re-check the hold inside the transaction. Concurrent retry requests may
    // both reach the idempotent refund above, but only the currently held run
    // should mutate scene/project state.
    const held = await tx.generationRun.findUnique({
      where: { id: run.id },
      select: { activeKey: true, status: true },
    });
    if (!held || held.activeKey !== run.activeKey || held.status !== "needs_reconciliation") {
      return;
    }

    await tx.generationRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        activeKey: null,
        refundTransactionId,
        error: run.error
          ? `${run.error} [auto-reconciled: explicit reference image download failure; no provider task was created]`
          : "Auto-reconciled: explicit reference image download failure; no provider task was created",
      },
    });
    await tx.videoScene.updateMany({
      where: {
        projectId: project.id,
        id: { in: safety.sceneIds },
        taskId: null,
        videoUrl: null,
      },
      data: { status: "pending" },
    });
    await tx.videoProject.update({
      where: { id: project.id },
      data: { status: "draft" },
    });
  });

  return { reconciled: true };
}

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

export async function POST(req: NextRequest) {
  let authResult: Awaited<ReturnType<typeof requireAuth>> | null = null;
  try {
    authResult = await requireAuth();
    if (!authResult.ok) return authResult.response;
    const userId = authResult.session.userId;

    const { projectId, retry = false } = await req.json();
    if (!projectId) return NextResponse.json({ success: false, error: "Project ID is required" }, { status: 400 });

    let project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } }, characters: { orderBy: { createdAt: "asc" } } },
    });
    if (!project) return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    if (!project.userId || project.userId !== userId) {
      return NextResponse.json({ success: false, error: "You don't have access to this project" }, { status: 403 });
    }
    if (!project.scenes.length) return NextResponse.json({ success: false, error: "No scenes in project" }, { status: 400 });

    const activeKey = `project:${projectId}`;
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
              message: `Resuming ${sceneCount} unfinished scene${sceneCount === 1 ? "" : "s"}.`,
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

    const QUEUED_STALE_MS = 5 * 60_000;
    const scenesToProcess = project.scenes.filter((s) => !s.videoUrl && (
      s.status === "pending" ||
      (s.status === "queued" && Date.now() - s.updatedAt.getTime() > QUEUED_STALE_MS) ||
      (s.status === "generating" && !s.taskId) ||
      (s.status === "failed" && s.errorMessage?.toLowerCase().includes("rate"))
    ));
    const legacyRunActive = project.scenes.some((s) =>
      (s.status === "generating" && s.taskId) ||
      (s.status === "queued" && !s.videoUrl && Date.now() - s.updatedAt.getTime() <= QUEUED_STALE_MS)
    );

    if (!scenesToProcess.length) {
      if (legacyRunActive) return NextResponse.json({ success: true, message: "Generation already in progress.", sceneCount: 0, alreadyRunning: true });
      await db.videoProject.update({ where: { id: projectId }, data: { status: "completed" } });
      return NextResponse.json({ success: true, message: "All scenes already have videos.", sceneCount: project.scenes.length, alreadyDone: true });
    }

    const sceneCharges = await Promise.all(
      scenesToProcess.map(async (scene) => {
        const resolvedModel = resolveModelForRequest(
          project.videoModel,
          hasProviderReference(scene, project.characters)
        );
        const engineCharge = await getEngineChargeInfo(resolvedModel);
        const needsThumbnail = !scene.imageUrl;
        return {
          sceneId: scene.id,
          model: resolvedModel,
          tokens: engineCharge.tokensPerClip + (needsThumbnail ? PRICING.image_gen.tokens : 0),
          costUsd: engineCharge.costUsdPerClip + (needsThumbnail ? PRICING.image_gen.costUsd : 0),
          needsThumbnail,
        };
      })
    );
    const totalTokensNeeded = sceneCharges.reduce((sum, charge) => sum + charge.tokens, 0);
    const totalCostUsd = sceneCharges.reduce((sum, charge) => sum + charge.costUsd, 0);
    const tokensPerScene = Math.ceil(totalTokensNeeded / scenesToProcess.length);
    const costUsdPerScene = totalCostUsd / scenesToProcess.length;
    const tokenCheck = await checkTokens(userId, totalTokensNeeded);
    if (!tokenCheck.hasEnough) {
      return NextResponse.json({
        success: false,
        error: `Insufficient tokens. You need ${totalTokensNeeded} tokens but have ${tokenCheck.balance}.`,
        tokensNeeded: totalTokensNeeded,
        tokensAvailable: tokenCheck.balance,
        costBreakdown: {
          sceneCount: scenesToProcess.length,
          thumbnailCount: sceneCharges.filter((charge) => charge.needsThumbnail).length,
          totalTokens: totalTokensNeeded,
        },
      }, { status: 402 });
    }

    let run;
    try {
      run = await db.generationRun.create({
        data: {
          projectId,
          userId,
          sceneIds: JSON.stringify(scenesToProcess.map((scene) => scene.id)),
          activeKey,
          status: "queued",
          totalTokens: totalTokensNeeded,
          tokensPerScene,
          costUsdPerScene,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const active = await db.generationRun.findUnique({ where: { activeKey } });
        return NextResponse.json({ success: true, alreadyRunning: true, generationRunId: active?.id, message: "Generation already in progress." });
      }
      throw error;
    }

    const deduction = await deductTokensForOperation({
      userId,
      operation: "video_gen",
      description: `Generate ${scenesToProcess.length} scenes for "${project.title}"`,
      referenceId: projectId,
      idempotencyKey: `generation:${run.id}:charge`,
      customTokens: totalTokensNeeded,
      customCostUsd: totalCostUsd,
    });
    if (!deduction.success) {
      await db.generationRun.update({
        where: { id: run.id },
        data: { status: "failed", activeKey: null, error: deduction.error || "Token charge failed" },
      }).catch(() => undefined);
      return NextResponse.json({ success: false, error: deduction.error || "Failed to process tokens" }, { status: 402 });
    }

    await db.generationRun.update({
      where: { id: run.id },
      data: { status: "running", chargeTransactionId: deduction.transactionId || null },
    });
    await db.videoProject.update({ where: { id: projectId }, data: { status: "generating" } });

    for (const scene of scenesToProcess) {
      await db.videoScene.update({ where: { id: scene.id }, data: { status: "queued", taskId: null, errorMessage: null } });
    }

    // Durable handoff: the PostgreSQL-backed generation worker claims this
    // GenerationRun and performs all provider submission/polling outside the
    // Next.js process. A web restart after this response cannot lose the job.

    return NextResponse.json({
      success: true,
      message: `Generating ${scenesToProcess.length} scene${scenesToProcess.length > 1 ? "s" : ""}.`,
      generationRunId: run.id,
      sceneCount: scenesToProcess.length,
      totalScenes: project.scenes.length,
      tokensCharged: totalTokensNeeded,
      remainingTokens: deduction.remainingTokens,
      refundedAndRecharged: previousChargeRefunded || undefined,
    });
  } catch (error) {
    return zaiErrorResponse(error, {
      session: authResult?.ok ? authResult.session : null,
      logLabel: "generate-video",
    });
  }
}
