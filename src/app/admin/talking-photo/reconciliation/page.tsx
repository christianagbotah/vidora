"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ReconciliationAction =
  | "retry_release"
  | "confirm_not_submitted_release"
  | "retry_billing_capture"
  | "retry_provider_status"
  | "close_speech_release_remainder";

interface ReconciliationJob {
  id: string;
  userId: string;
  imageAssetId: string;
  audioAssetId: string;
  status: string;
  durationSeconds: number;
  providerTaskId?: string | null;
  creditReservationId?: string | null;
  error?: string | null;
  reconciliationKind?: string | null;
  reconciliationAt?: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    name?: string | null;
  };
  imageAsset: {
    id: string;
    originalName: string;
    url: string;
  };
  audioAsset: {
    id: string;
    originalName: string;
    url: string;
    durationSeconds?: number | null;
  };
  reservation?: {
    id: string;
    status: string;
    reservedCredits: number;
    capturedCredits: number;
    releasedCredits: number;
    quote: {
      id: string;
      creditsRequired: number;
      customerPriceUsd: number;
      providerCostUsd: number;
      pricingVersion: string;
    };
  } | null;
  allowedActions: ReconciliationAction[];
}

interface SpeechReconciliationJob {
  id: string;
  userId: string;
  status: string;
  script: string;
  voice: string;
  providerModel: string;
  chunkCount: number;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    name?: string | null;
  };
  reservation?: ReconciliationJob["reservation"];
  allowedActions: ReconciliationAction[];
}

const KIND_LABELS: Record<string, string> = {
  ambiguous_submission: "Ambiguous provider submission",
  reservation_release: "Reservation release failed",
  billing_capture: "Billing capture failed",
  billing_state: "Unexpected billing state",
  provider_lookup: "Provider request not found",
  provider_status: "Unknown provider status",
  asset_integrity: "Source asset integrity",
};

function ageLabel(value?: string | null): string {
  if (!value) return "unknown";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function actionLabel(action: ReconciliationAction): string {
  switch (action) {
    case "retry_release": return "Retry safe credit release";
    case "confirm_not_submitted_release": return "Confirm absent & release";
    case "retry_billing_capture": return "Retry billing capture";
    case "retry_provider_status": return "Recheck provider status";
    case "close_speech_release_remainder": return "Close voice job & release unused credits";
  }
}

export default function TalkingPhotoReconciliationPage() {
  const [jobs, setJobs] = useState<ReconciliationJob[]>([]);
  const [speechJobs, setSpeechJobs] = useState<SpeechReconciliationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/talking-photo/reconciliation", {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        throw new Error(body.error || "Unable to load Talking Photo reconciliation queue");
      }
      setJobs(Array.isArray(body.jobs) ? body.jobs : []);
      setSpeechJobs(Array.isArray(body.speechJobs) ? body.speechJobs : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load reconciliation queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (job: ReconciliationJob, action: ReconciliationAction) => {
    let confirmedNoProviderWork = false;
    if (action === "confirm_not_submitted_release") {
      const confirmation = window.prompt(
        "This action releases reserved credits for an ambiguous submission. Check the fal provider console first. Type NO PROVIDER WORK only if you verified that no request was accepted.",
      );
      if (confirmation !== "NO PROVIDER WORK") return;
      confirmedNoProviderWork = true;
    }

    setRunning(`${job.id}:${action}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/talking-photo/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          action,
          note: notes[job.id] || "",
          confirmedNoProviderWork,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        throw new Error(body.error || "Reconciliation action failed");
      }
      setMessage(
        action === "retry_provider_status" && body.providerStatus
          ? `Provider status recovered: ${body.providerStatus}`
          : "Reconciliation action completed safely.",
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reconciliation action failed");
    } finally {
      setRunning(null);
    }
  };

  const closeSpeechJob = async (job: SpeechReconciliationJob) => {
    setRunning(`${job.id}:close_speech_release_remainder`);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/talking-photo/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobType: "speech",
          jobId: job.id,
          action: "close_speech_release_remainder",
          note: notes[job.id] || "",
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        throw new Error(body.error || "Voice reconciliation action failed");
      }
      setMessage(`Voice job closed safely. Released ${body.creditsReleased ?? 0} unused credits; captured Qwen credits were preserved.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Voice reconciliation action failed");
    } finally {
      setRunning(null);
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">
            Admin · Provider safety
          </p>
          <h1 className="mt-2 text-2xl font-bold">Talking Photo reconciliation</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Resolve quarantined fal/billing states without automatically repeating an ambiguous paid provider request.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/billing">Billing</Link>
          </Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="flex gap-3 p-4 text-sm text-amber-950">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Fail-closed operator policy</p>
            <p className="mt-1 text-xs leading-5 text-amber-900/80">
              Never release ambiguous-submission credits until the provider console proves no work was accepted.
              Jobs with a persisted provider request ID are treated as potentially billable and cannot use the credit-release action.
            </p>
          </div>
        </CardContent>
      </Card>

      {speechJobs.length ? (
        <div className="space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-fuchsia-700">Digital Actor voice reconciliation</p>
            <p className="mt-1 text-sm text-muted-foreground">
              These Qwen jobs preserve any captured provider charges. The only automated action releases unused reserved credits and closes the job.
            </p>
          </div>
          {speechJobs.map((job) => {
            const reservation = job.reservation;
            const remaining = reservation
              ? reservation.reservedCredits - reservation.capturedCredits - reservation.releasedCredits
              : null;
            return (
              <Card key={job.id} className="border-fuchsia-200">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <AlertTriangle className="h-5 w-5 text-fuchsia-600" />
                    Quarantined scripted voice
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    job {job.id} · user {job.user.email} · model {job.providerModel} · {job.chunkCount} part{job.chunkCount === 1 ? "" : "s"}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Script</p>
                    <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs leading-5">{job.script}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border p-3 text-xs">
                      <p className="font-semibold">Voice</p>
                      <p className="mt-1 text-muted-foreground">{job.voice}</p>
                    </div>
                    <div className="rounded-xl border p-3 text-xs">
                      <p className="font-semibold">Reservation</p>
                      {reservation ? (
                        <>
                          <p className="mt-1 text-muted-foreground">
                            {reservation.reservedCredits} reserved · {reservation.capturedCredits} captured · {reservation.releasedCredits} released
                          </p>
                          <p className="mt-1 font-semibold">remaining {remaining} credits</p>
                        </>
                      ) : (
                        <p className="mt-1 text-amber-700">No reservation record resolved</p>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                    {job.error || "No quarantine detail recorded"}
                  </div>
                  <textarea
                    value={notes[job.id] || ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [job.id]: event.target.value }))}
                    placeholder="Optional operator note"
                    maxLength={1000}
                    className="min-h-20 w-full rounded-xl border bg-background px-3 py-2 text-sm"
                  />
                  <Button
                    variant="outline"
                    disabled={Boolean(running) || !reservation}
                    onClick={() => void closeSpeechJob(job)}
                  >
                    {running === `${job.id}:close_speech_release_remainder` ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Close voice job & release unused credits
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Already-captured Qwen credits are not refunded by this action.
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {loading && jobs.length === 0 && speechJobs.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : jobs.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-44 flex-col items-center justify-center text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            <p className="mt-3 font-semibold">No Talking Photo jobs need reconciliation</p>
            <p className="mt-1 text-sm text-muted-foreground">The durable provider queue has no quarantined work.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => {
            const reservation = job.reservation;
            const remaining = reservation
              ? reservation.reservedCredits - reservation.capturedCredits - reservation.releasedCredits
              : null;
            return (
              <Card key={job.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <AlertTriangle className="h-5 w-5 text-amber-600" />
                        {KIND_LABELS[job.reconciliationKind || ""] || "Unclassified reconciliation"}
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        job {job.id} · quarantined {ageLabel(job.reconciliationAt)} ago · user {job.user.email}
                      </p>
                    </div>
                    <span className="rounded-full border bg-muted px-2.5 py-1 text-xs font-semibold">
                      {job.reconciliationKind || "unknown"}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
                    <img
                      src={job.imageAsset.url}
                      alt=""
                      className="aspect-square w-full rounded-xl border object-cover"
                    />
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-xl border p-3">
                        <p className="text-xs text-muted-foreground">Source</p>
                        <p className="mt-1 truncate text-sm font-semibold">{job.imageAsset.originalName}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{job.audioAsset.originalName}</p>
                        <p className="mt-1 text-xs">{Math.ceil(job.durationSeconds)} sec</p>
                      </div>
                      <div className="rounded-xl border p-3">
                        <p className="text-xs text-muted-foreground">Provider request</p>
                        <p className="mt-1 break-all font-mono text-xs">{job.providerTaskId || "No persisted request id"}</p>
                      </div>
                      <div className="rounded-xl border p-3">
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CircleDollarSign className="h-3.5 w-3.5" /> Reservation
                        </p>
                        {reservation ? (
                          <>
                            <p className="mt-1 text-sm font-semibold">{reservation.status}</p>
                            <p className="mt-1 text-xs">
                              {reservation.reservedCredits} reserved · {reservation.capturedCredits} captured · {reservation.releasedCredits} released
                            </p>
                            <p className="mt-1 text-xs font-semibold">remaining {remaining} credits</p>
                          </>
                        ) : (
                          <p className="mt-1 text-xs text-amber-700">No reservation record resolved</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Quarantine reason</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5">{job.error || "No error detail recorded"}</p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold" htmlFor={`note-${job.id}`}>Operator note</label>
                    <textarea
                      id={`note-${job.id}`}
                      value={notes[job.id] || ""}
                      onChange={(event) => setNotes((current) => ({ ...current, [job.id]: event.target.value }))}
                      placeholder="Optional evidence or provider-console reference"
                      maxLength={1000}
                      className="mt-1 min-h-20 w-full rounded-xl border bg-background px-3 py-2 text-sm"
                    />
                  </div>

                  {job.allowedActions.length ? (
                    <div className="flex flex-wrap gap-2">
                      {job.allowedActions.map((action) => (
                        <Button
                          key={action}
                          variant={action === "confirm_not_submitted_release" ? "destructive" : "outline"}
                          disabled={Boolean(running)}
                          onClick={() => void runAction(job, action)}
                        >
                          {running === `${job.id}:${action}` ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          {actionLabel(action)}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                      No automated money-moving action is permitted for this reconciliation kind. Inspect the source assets, billing ledger and provider records manually before changing state.
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
