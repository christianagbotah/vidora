from pathlib import Path
import re


def replace_exact(text: str, old: str, new: str, *, expected: int = 1, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} exact match(es), found {count}")
    return text.replace(old, new)


path = Path("src/app/api/export-video/route.ts")
text = path.read_text(encoding="utf-8")

text = replace_exact(
    text,
    'import { NextRequest, NextResponse } from "next/server";',
    'import { NextRequest, NextResponse } from "next/server";\nimport { Prisma } from "@prisma/client";',
    label="Prisma import",
)
text = replace_exact(
    text,
    'async function runExportJob(jobId: string): Promise<void> {',
    'export async function runExportJob(jobId: string): Promise<void> {',
    label="export worker function",
)
text = replace_exact(
    text,
    '''          status: "done",
          progress: 100,''',
    '''          status: "done",
          activeKey: null,
          progress: 100,''',
    label="clear active key on success",
)
text = replace_exact(
    text,
    'data: { status: "failed", step: "Failed", error: friendly, updatedAt: new Date() },',
    'data: { status: "failed", activeKey: null, step: "Failed", error: friendly, updatedAt: new Date() },',
    label="clear active key on handled failure",
)

old_active = '''    // ── Reuse / clean up a previous active job for this project ──────────
    const activeJob = await db.exportJob.findFirst({
      where: { projectId, status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "desc" },
    });
    if (activeJob) {
      const isFresh = Date.now() - activeJob.updatedAt.getTime() < STALE_JOB_MS;
      if (isFresh) {
        // An export is already running — attach to it instead of starting a
        // second one (double-click / retry protection).
        return NextResponse.json({
          success: true,
          jobId: activeJob.id,
          resumed: true,
          progress: activeJob.progress,
          step: activeJob.step,
        });
      }
      // Stale: the server likely restarted mid-export. Mark it failed so the
      // UI can show a clean error instead of polling forever.
      await db.exportJob
        .update({
          where: { id: activeJob.id },
          data: {
            status: "failed",
            step: "Failed",
            error: "Export was interrupted (the server may have restarted). Please try again.",
            updatedAt: new Date(),
          },
        })
        .catch(() => { /* ignore */ });
    }
'''
new_active = '''    // Durable one-active-export guard. The unique activeKey closes the
    // double-click/concurrent-request race at the database boundary.
    const activeKey = `project:${projectId}`;
    const activeJob = await db.exportJob.findUnique({ where: { activeKey } });
    if (activeJob) {
      return NextResponse.json({
        success: true,
        jobId: activeJob.id,
        resumed: true,
        progress: activeJob.progress,
        step: activeJob.step,
      });
    }
'''
text = replace_exact(text, old_active, new_active, label="replace stale web-job handling")

old_create = '''    // ── Create the job and kick off the pipeline in the background ───────
    // The response returns immediately (~<1s) so gateway/proxy timeouts
    // (Cloudflare 524, nginx proxy_read_timeout) can never kill an export.
    const job = await db.exportJob.create({
      data: {
        projectId,
        userId:
          authResult.session.userId && authResult.session.userId !== "guest"
            ? authResult.session.userId
            : null,
        status: "queued",
        progress: 0,
        step: "Queued",
        params: JSON.stringify({ quality, transition, format, withTitleCard, includeAudio }),
      },
    });

    void runExportJob(job.id);

    return NextResponse.json({ success: true, jobId: job.id });'''
new_create = '''    // ── Persist the job only; the dedicated PostgreSQL-backed export worker
    // claims it and performs ffmpeg work outside the Next.js request process.
    let job;
    try {
      job = await db.exportJob.create({
        data: {
          projectId,
          userId:
            authResult.session.userId && authResult.session.userId !== "guest"
              ? authResult.session.userId
              : null,
          activeKey,
          status: "queued",
          progress: 0,
          step: "Queued",
          params: JSON.stringify({ quality, transition, format, withTitleCard, includeAudio }),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrent = await db.exportJob.findUnique({ where: { activeKey } });
        if (concurrent) {
          return NextResponse.json({
            success: true,
            jobId: concurrent.id,
            resumed: true,
            progress: concurrent.progress,
            step: concurrent.step,
          });
        }
      }
      throw error;
    }

    return NextResponse.json({ success: true, jobId: job.id });'''
text = replace_exact(text, old_create, new_create, label="enqueue-only export route")

# A stale heartbeat is now recoverable by the worker; status polling must never
# turn a recoverable persisted job into a terminal failure.
stale_pattern = re.compile(
    r'''/\*\*\n \* Mark a job as failed if its heartbeat went silent.*?\n\}\n\nexport async function GET\(req: NextRequest\) \{''',
    re.S,
)
stale_replacement = '''/**
 * Present a stale active job as recoverable. The export worker owns terminal
 * state transitions and will reclaim stale running jobs after its lease.
 */
function staleJobView(job: {
  status: string;
}): { status: string; step: string; error: string | null } {
  return {
    status: job.status,
    step: "Waiting for export worker recovery…",
    error: null,
  };
}

export async function GET(req: NextRequest) {'''
text, count = stale_pattern.subn(stale_replacement, text, count=1)
if count != 1:
    raise SystemExit(f"stale status helper: expected 1 block, found {count}")

text = replace_exact(
    text,
    '''      const failed = await reapStaleJob(job);
      status = failed.status;
      step = failed.step;
      error = failed.error;''',
    '''      const recovering = staleJobView(job);
      status = recovering.status;
      step = recovering.step;
      error = recovering.error;''',
    label="stale status view call",
)

text = replace_exact(
    text,
    '// ─── Route: POST — validate fast, create job, run in background ───────────────',
    '// ─── Route: POST — validate fast and enqueue a durable export job ─────────────',
    label="route comment",
)

path.write_text(text, encoding="utf-8")
print("Export route is now enqueue-only with durable active-key recovery semantics.")
