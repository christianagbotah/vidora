from pathlib import Path


def replace_exact(text: str, old: str, new: str, *, expected: int = 1, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} exact match(es), found {count}")
    return text.replace(old, new)


path = Path("src/app/api/generate-video/route.ts")
text = path.read_text(encoding="utf-8")

text = replace_exact(
    text,
    'import { checkTokens, deductTokensForOperation, refundTokens } from "@/lib/tokens";',
    'import { checkTokens, deductTokensForOperation } from "@/lib/tokens";',
    label="remove ambiguous refund import",
)

text = replace_exact(
    text,
    '''        if (failed > 0) {
          const refundAmount = failed * tokensPerScene;
          const refund = await refundTokens({
            userId,
            amount: refundAmount,
            description: `Refund: ${failed} failed scene${failed > 1 ? "s" : ""} in "${project.title}"`,
            referenceId: projectId,
            operation: "video_gen",
            idempotencyKey: `generation:${run.id}:refund`,
            relatedTransactionId: deduction.transactionId,
          });
          if (refund.transactionId) {
            await db.generationRun.update({ where: { id: run.id }, data: { refundTransactionId: refund.transactionId } }).catch(() => undefined);
          }
        }

''',
    '''        // Do not automatically refund failed scenes here. A provider task
        // may have been accepted even when submission/polling later failed, and
        // thumbnail generation may already have incurred cost. Uncertain runs
        // stay locked for explicit reconciliation so Vidora never refunds a
        // charge while provider work may still complete.

''',
    label="remove coarse failed-scene refund",
)

text = replace_exact(
    text,
    '''        } else {
          await db.videoProject.update({ where: { id: projectId }, data: { status: failed > 0 ? "failed" : "generating" } });
          await db.generationRun.update({ where: { id: run.id }, data: { status: failed > 0 ? "partial_failed" : "completed", activeKey: null } });
        }''',
    '''        } else if (failed > 0) {
          await db.videoProject.update({ where: { id: projectId }, data: { status: "failed" } });
          await db.generationRun.update({
            where: { id: run.id },
            data: {
              status: "needs_reconciliation",
              error: `${failed} scene${failed > 1 ? "s" : ""} failed or had uncertain provider completion`,
            },
          });
        } else {
          await db.generationRun.update({ where: { id: run.id }, data: { status: "completed", activeKey: null } });
        }''',
    label="retain run lock on failed scenes",
)

text = replace_exact(
    text,
    '''        // Refund only if there are no submitted provider tasks. If task IDs
        // exist, retain the active run for reconciliation instead of risking a
        // refund followed by a successful provider charge.
        const submitted = await db.videoScene.count({ where: { projectId, taskId: { not: null }, videoUrl: null } }).catch(() => 1);
        if (submitted === 0) {
          const refund = await refundTokens({
            userId,
            amount: totalTokensNeeded,
            description: `Full refund: generation failed before provider submission for "${project.title}"`,
            referenceId: projectId,
            operation: "video_gen",
            idempotencyKey: `generation:${run.id}:fatal-refund`,
            relatedTransactionId: deduction.transactionId,
          });
          await db.generationRun.update({
            where: { id: run.id },
            data: { status: "failed", activeKey: null, refundTransactionId: refund.transactionId || null, error: "Generation interrupted before provider submission" },
          }).catch(() => undefined);
        } else {
          await db.generationRun.update({
            where: { id: run.id },
            data: { status: "needs_reconciliation", error: "Worker interrupted after provider submission" },
          }).catch(() => undefined);
        }''',
    '''        // A missing taskId is not proof that the provider never accepted the
        // request: the process can fail after provider acknowledgement but before
        // the taskId is persisted. Never auto-refund this ambiguous window.
        await db.generationRun.update({
          where: { id: run.id },
          data: {
            status: "needs_reconciliation",
            error: "Generation worker was interrupted; provider completion must be reconciled before refund or retry",
          },
        }).catch(() => undefined);''',
    label="remove fatal ambiguous refund",
)

path.write_text(text, encoding="utf-8")
print("Applied asserted generation economics repair.")
