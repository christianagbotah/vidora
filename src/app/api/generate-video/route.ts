import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { refundTokens } from "@/lib/tokens";
import { buildProjectGenerationQuoteLines } from "@/lib/project-generation-quote";
import {
  findReservationByReference,
  getBillingQuote,
  releaseReservationRemainder,
  reserveBillingQuote,
  type BillingQuoteLine,
} from "@/lib/credit-reservations";
import {
  getGenerationRunBillingLink,
  setGenerationRunBillingLink,
} from "@/lib/generation-run-billing";
import {
  hasActiveLegacyGeneration,
  isSceneEligibleForNewGeneration,
} from "@/lib/generation-scope";
import {
  canAutoReconcileReferenceDownloadFailure,
  canRecoverHeldProviderRun,
} from "@/lib/generation-reconciliation";

export const runtime = "nodejs";

function quoteLineSignature(lines: BillingQuoteLine[]): string {
  return JSON.stringify(
    [...lines]
      .map((line) => ({
        lineKey: line.lineKey,
        provider: line.provider,
        model: line.model,
        operation: line.operation,
        billingUnit: line.billingUnit,
        quantity: line.quantity,
        credits: line.credits,
        pricingVersion: line.pricingVersion,
      }))
      .sort((a, b) => a.lineKey.localeCompare(b.lineKey)),
  );
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
  const billing = await getGenerationRunBillingLink(run.id);
  if (billing.creditReservationId && !refundTransactionId) {
    const released = await releaseReservationRemainder({
      reservationId: billing.creditReservationId,
      userId,
      reason: `Generation run ${run.id}: explicit reference image failure before provider task creation`,
    });
    if (released.creditsReleased > 0 || released.alreadyReleased) {
      refundTransactionId = `reservation:${billing.creditReservationId}:released`;
    }
  } else if (run.totalTokens > 0 && !refundTransactionId) {
    // Backward-compatible reconciliation for runs created before billing-v2.
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
    const held = await tx.generationRun.findUnique({
      where: { id: run.id },
      select: { activeKey: true, status: true },
    });
    if (!held || held.activeKey !== run.activeKey || held.status !== "needs_reconciliation") return;

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

  const billing = await getGenerationRunBillingLink(run.id);
  if (!billing.creditReservationId && !run.chargeTransactionId) {
    return { recovered: false, reason: "The previous generation has no verifiable prepaid funding." };
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
    ) return false;

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
          ? `${run.error} [user retry: safely resumed with original prepaid funding]`
          : "User retry: safely resumed with original prepaid funding",
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

    const body = await req.json() as Record<string, unknown>;
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const retry = body.retry === true;
    const quoteId = typeof body.quoteId === "string" ? body.quoteId.trim() : "";
    if (!projectId) {
      return NextResponse.json({ success: false, error: "Project ID is required" }, { status: 400 });
    }

    let project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!project) return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    if (!project.userId || project.userId !== userId) {
      return NextResponse.json({ success: false, error: "You don't have access to this project" }, { status: 403 });
    }
    if (!project.scenes.length) {
      return NextResponse.json({ success: false, error: "No scenes in project" }, { status: 400 });
    }

    const activeKey = `project:${projectId}`;
    let previousChargeRefunded = false;
    const existingRun = await db.generationRun.findUnique({ where: { activeKey } });
    if (existingRun) {
      const existingBilling = await getGenerationRunBillingLink(existingRun.id);

      // Crash recovery: reservation succeeded but the process died before the
      // durable run was flipped from queued -> running. Reattach and resume;
      // never reserve/debit a second time.
      if (existingRun.status === "queued") {
        const reservation = existingBilling.creditReservationId
          ? null
          : await findReservationByReference(existingRun.id);
        const reservationId = existingBilling.creditReservationId || reservation?.id || null;
        if (reservationId) {
          if (!existingBilling.creditReservationId) {
            const quote = await getBillingQuote(reservation!.quoteId);
            if (!quote) {
              return NextResponse.json({ success: false, error: "Reserved generation quote is missing", reconciliationRequired: true }, { status: 409 });
            }
            await setGenerationRunBillingLink({
              runId: existingRun.id,
              billingQuoteId: quote.id,
              creditReservationId: reservationId,
            });
          }
          await db.generationRun.update({ where: { id: existingRun.id }, data: { status: "running" } });
          return NextResponse.json({
            success: true,
            alreadyRunning: true,
            resumedPrepaidRun: true,
            generationRunId: existingRun.id,
            message: "Recovered a prepaid generation run after an interrupted handoff.",
          });
        }
        return NextResponse.json({
          success: false,
          error: "An interrupted generation run has no verifiable credit reservation. Provider execution remains blocked.",
          reconciliationRequired: true,
          generationRunId: existingRun.id,
        }, { status: 409 });
      }

      if (existingRun.status === "needs_reconciliation") {
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
        if (!existingBilling.creditReservationId && !existingRun.chargeTransactionId) {
          return NextResponse.json({
            success: false,
            error: "Generation run is not backed by a verifiable prepaid reservation.",
            reconciliationRequired: true,
            generationRunId: existingRun.id,
          }, { status: 409 });
        }
        return NextResponse.json({
          success: true,
          message: "Generation already in progress.",
          alreadyRunning: true,
          generationRunId: existingRun.id,
        });
      }
    }

    const scenesToProcess = project.scenes.filter((scene) => isSceneEligibleForNewGeneration(scene));
    const legacyRunActive = project.scenes.some((scene) => hasActiveLegacyGeneration(scene));

    if (!scenesToProcess.length) {
      if (legacyRunActive) {
        return NextResponse.json({ success: true, message: "Generation already in progress.", sceneCount: 0, alreadyRunning: true });
      }
      const incomplete = project.scenes.some((scene) => !scene.videoUrl);
      if (!incomplete) {
        await db.videoProject.update({ where: { id: projectId }, data: { status: "completed" } });
        return NextResponse.json({ success: true, message: "All scenes already have videos.", sceneCount: project.scenes.length, alreadyDone: true });
      }
      return NextResponse.json({
        success: false,
        error: "No scene is currently eligible for a new provider submission. Resolve failed scenes before generating again.",
        code: "NO_ELIGIBLE_SCENES",
      }, { status: 409 });
    }

    // A NEW paid run always requires explicit customer confirmation of a fresh
    // quote. Retry/resume paths above reuse an already funded durable run.
    if (!quoteId) {
      return NextResponse.json({
        success: false,
        error: "Review and confirm the current generation cost before starting paid generation.",
        code: "BILLING_QUOTE_REQUIRED",
      }, { status: 409 });
    }

    const currentBilling = await buildProjectGenerationQuoteLines({
      projectId,
      userId,
      sceneIds: scenesToProcess.map((scene) => scene.id),
    });
    const billingQuote = await getBillingQuote(quoteId);
    if (
      !billingQuote ||
      billingQuote.userId !== userId ||
      billingQuote.projectId !== projectId ||
      billingQuote.status !== "open" ||
      billingQuote.expiresAt.getTime() <= Date.now() ||
      quoteLineSignature(billingQuote.breakdown) !== quoteLineSignature(currentBilling.lines)
    ) {
      return NextResponse.json({
        success: false,
        error: "The generation cost changed or the quote expired. Review the refreshed cost before generating.",
        code: "BILLING_QUOTE_STALE",
      }, { status: 409 });
    }

    const totalTokensNeeded = billingQuote.creditsRequired;
    const totalCostUsd = billingQuote.providerCostUsd;
    const tokensPerScene = Math.ceil(totalTokensNeeded / scenesToProcess.length);
    const costUsdPerScene = totalCostUsd / scenesToProcess.length;

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
        return NextResponse.json({
          success: true,
          alreadyRunning: true,
          generationRunId: active?.id,
          message: "Generation already in progress.",
        });
      }
      throw error;
    }

    let reserved;
    try {
      reserved = await reserveBillingQuote({
        quoteId: billingQuote.id,
        userId,
        referenceId: run.id,
        idempotencyKey: `generation:${run.id}:reservation`,
      });
      await setGenerationRunBillingLink({
        runId: run.id,
        billingQuoteId: billingQuote.id,
        creditReservationId: reserved.reservation.id,
      });

      // The worker only claims status=running/waiting_provider. Queue scene
      // state first, then flip the run to running as the final durable handoff.
      await db.$transaction(async (tx) => {
        await tx.videoScene.updateMany({
          where: { projectId, id: { in: scenesToProcess.map((scene) => scene.id) } },
          data: { status: "queued", taskId: null, errorMessage: null },
        });
        await tx.videoProject.update({ where: { id: projectId }, data: { status: "generating" } });
        await tx.generationRun.update({ where: { id: run.id }, data: { status: "running", error: null } });
      });
    } catch (error) {
      if (reserved?.reservation.id) {
        await releaseReservationRemainder({
          reservationId: reserved.reservation.id,
          userId,
          reason: `Generation run ${run.id} failed before durable worker handoff`,
        }).catch(() => undefined);
      }
      await db.generationRun.update({
        where: { id: run.id },
        data: { status: "failed", activeKey: null, error: error instanceof Error ? error.message : "Credit reservation failed" },
      }).catch(() => undefined);
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : "Could not reserve generation credits",
        code: "CREDIT_RESERVATION_FAILED",
      }, { status: 402 });
    }

    return NextResponse.json({
      success: true,
      message: `Generating ${scenesToProcess.length} scene${scenesToProcess.length > 1 ? "s" : ""}.`,
      generationRunId: run.id,
      sceneCount: scenesToProcess.length,
      totalScenes: project.scenes.length,
      tokensCharged: 0,
      creditsReserved: totalTokensNeeded,
      remainingTokens: reserved.wallet.availableCredits,
      refundedAndRecharged: previousChargeRefunded || undefined,
    });
  } catch (error) {
    return zaiErrorResponse(error, {
      session: authResult?.ok ? authResult.session : null,
      logLabel: "generate-video",
    });
  }
}
