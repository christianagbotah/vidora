import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSceneAccess } from "@/lib/project-auth";
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

export const runtime = "nodejs";

/**
 * Compare the customer-visible billable work contract, not derived floating
 * point accounting metadata. The reservation transaction independently locks
 * ProviderPrice and re-checks pricingVersion before any credits move.
 *
 * This deliberately matches the project-generation quote compatibility rule:
 * a quote remains usable when the exact work, credits and verified price
 * version are unchanged, even if recomputed diagnostic USD fields differ by an
 * irrelevant representation detail.
 */
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const sceneId = typeof body.sceneId === "string" ? body.sceneId.trim() : "";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const quoteId = typeof body.quoteId === "string" ? body.quoteId.trim() : "";
    if (!sceneId || !prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt and sceneId are required" },
        { status: 400 },
      );
    }

    const access = await requireSceneAccess(sceneId, true);
    if (!access.ok) return access.response;
    if (body.projectId && String(body.projectId) !== access.scene.projectId) {
      return NextResponse.json(
        { success: false, error: "Scene does not belong to the supplied project" },
        { status: 400 },
      );
    }

    const projectId = access.scene.projectId;
    const userId = access.session.userId;
    if (!userId || userId === "guest") {
      return NextResponse.json(
        { success: false, error: "Please sign in to generate video" },
        { status: 401 },
      );
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: {
        scenes: { where: { id: sceneId }, take: 1 },
        characters: { orderBy: { createdAt: "asc" } },
      },
    });
    const scene = project?.scenes[0];
    if (!project || !scene) {
      return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
    }

    if (scene.taskId && !scene.videoUrl && scene.status === "generating") {
      return NextResponse.json({
        success: true,
        alreadyRunning: true,
        status: "generating",
        message: "Video generation is already in progress for this scene.",
      });
    }

    const activeKey = `project:${projectId}`;
    const existingRun = await db.generationRun.findUnique({ where: { activeKey } });
    if (existingRun) {
      const link = await getGenerationRunBillingLink(existingRun.id);
      if (existingRun.status === "queued") {
        const reservation = link.creditReservationId
          ? null
          : await findReservationByReference(existingRun.id);
        const reservationId = link.creditReservationId || reservation?.id || null;
        if (!reservationId) {
          return NextResponse.json({
            success: false,
            error: "An interrupted scene generation has no verifiable prepaid reservation. Provider execution remains blocked.",
            reconciliationRequired: true,
            generationRunId: existingRun.id,
          }, { status: 409 });
        }
        if (!link.creditReservationId) {
          const quote = await getBillingQuote(reservation!.quoteId);
          if (!quote) {
            return NextResponse.json({
              success: false,
              error: "Reserved generation quote is missing",
              reconciliationRequired: true,
              generationRunId: existingRun.id,
            }, { status: 409 });
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
          status: "generating",
          generationRunId: existingRun.id,
          message: "Recovered a prepaid scene generation after an interrupted handoff.",
        });
      }

      if (!link.creditReservationId && !existingRun.chargeTransactionId) {
        return NextResponse.json({
          success: false,
          error: "Generation run is not backed by verifiable prepaid funding.",
          reconciliationRequired: true,
          generationRunId: existingRun.id,
        }, { status: 409 });
      }
      return NextResponse.json({
        success: true,
        alreadyRunning: true,
        status: "generating",
        generationRunId: existingRun.id,
        message: "Generation is already in progress for this project.",
      });
    }

    if (!quoteId) {
      return NextResponse.json({
        success: false,
        error: "Review and confirm the current scene generation cost before regenerating.",
        code: "BILLING_QUOTE_REQUIRED",
      }, { status: 409 });
    }

    const currentBilling = await buildProjectGenerationQuoteLines({
      projectId,
      userId,
      sceneId,
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
        error: "The scene generation cost changed or the quote expired. Review the refreshed cost before regenerating.",
        code: "BILLING_QUOTE_STALE",
      }, { status: 409 });
    }

    const duration = Number.isFinite(Number(body.duration))
      ? Math.max(1, Math.min(30, Math.round(Number(body.duration))))
      : 10;
    const creditsRequired = billingQuote.creditsRequired;
    const costUsd = billingQuote.providerCostUsd;

    let run;
    try {
      run = await db.generationRun.create({
        data: {
          projectId,
          userId,
          targetSceneId: sceneId,
          sceneIds: JSON.stringify([sceneId]),
          activeKey,
          status: "queued",
          totalTokens: creditsRequired,
          tokensPerScene: creditsRequired,
          costUsdPerScene: costUsd,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const active = await db.generationRun.findUnique({ where: { activeKey } });
        return NextResponse.json({
          success: true,
          alreadyRunning: true,
          status: "generating",
          generationRunId: active?.id,
          message: "Generation is already in progress for this project.",
        });
      }
      throw error;
    }

    let reserved: Awaited<ReturnType<typeof reserveBillingQuote>> | undefined;
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

      await db.$transaction(async (tx) => {
        await tx.videoScene.update({
          where: { id: sceneId },
          data: {
            enhancedPrompt: prompt,
            duration,
            status: "queued",
            taskId: null,
            errorMessage: null,
          },
        });
        await tx.videoProject.update({
          where: { id: projectId },
          data: { status: "generating" },
        });
        await tx.generationRun.update({
          where: { id: run.id },
          data: { status: "running", error: null },
        });
      });
    } catch (error) {
      if (reserved?.reservation.id) {
        await releaseReservationRemainder({
          reservationId: reserved.reservation.id,
          userId,
          reason: `Single-scene generation run ${run.id} failed before durable worker handoff`,
        }).catch(() => undefined);
      }
      await db.generationRun.update({
        where: { id: run.id },
        data: { status: "failed", activeKey: null, error: error instanceof Error ? error.message : "Credit reservation failed" },
      }).catch(() => undefined);
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : "Could not reserve scene generation credits",
        code: "CREDIT_RESERVATION_FAILED",
      }, { status: 402 });
    }

    return NextResponse.json({
      success: true,
      status: "generating",
      generationRunId: run.id,
      tokensCharged: 0,
      creditsReserved: creditsRequired,
      remainingTokens: reserved.wallet.availableCredits,
      message: "Video generation started. This may take a few minutes.",
    });
  } catch (error) {
    console.error(
      "generate-video-scene:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to start generation" },
      { status: 500 },
    );
  }
}
