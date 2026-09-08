"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, Eye, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FullPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewUrl: string | null;
  isRebuilding: boolean;
  onRebuild: () => void | Promise<void>;
  onProceedToExport: () => void;
}

export function FullPreviewDialog({
  open,
  onOpenChange,
  previewUrl,
  isRebuilding,
  onRebuild,
  onProceedToExport,
}: FullPreviewDialogProps) {
  const [mediaFailed, setMediaFailed] = useState(false);
  const [reloadAttempt, setReloadAttempt] = useState(0);

  useEffect(() => {
    setMediaFailed(false);
    setReloadAttempt(0);
  }, [previewUrl, open]);

  const retryMedia = () => {
    setMediaFailed(false);
    setReloadAttempt((value) => value + 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl overflow-hidden p-0">
        <DialogHeader className="px-5 pt-5 sm:px-6 sm:pt-6">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
              <Eye className="h-4 w-4" />
            </span>
            Review Full Video
          </DialogTitle>
          <DialogDescription>
            Watch the assembled cut before exporting. This preview uses the current scene order, voices, music, ambience, and transitions.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 sm:px-6">
          {previewUrl && !mediaFailed ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-black shadow-inner">
              <video
                key={`${previewUrl}:${reloadAttempt}`}
                src={previewUrl}
                controls
                autoPlay
                preload="metadata"
                className="max-h-[65vh] w-full bg-black object-contain"
                onLoadedData={() => setMediaFailed(false)}
                onError={() => setMediaFailed(true)}
              />
            </div>
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-amber-200 bg-amber-50/70 px-6 py-10 text-center">
              <AlertTriangle className="mb-3 h-8 w-8 text-amber-600" />
              <h3 className="text-sm font-bold text-amber-900">Preview could not be loaded</h3>
              <p className="mt-1 max-w-md text-sm text-amber-800/80">
                The saved preview may have expired, moved, or been interrupted while loading. Your project scenes are unchanged.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {previewUrl && (
                  <Button type="button" variant="outline" onClick={retryMedia} disabled={isRebuilding}>
                    <RefreshCw className="mr-1.5 h-4 w-4" />Retry Loading
                  </Button>
                )}
                <Button type="button" onClick={() => void onRebuild()} disabled={isRebuilding} className="btn-gradient">
                  {isRebuilding ? (
                    <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Rebuilding…</>
                  ) : (
                    <><RefreshCw className="mr-1.5 h-4 w-4" />Rebuild Preview</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-5 pb-5 sm:px-6 sm:pb-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            className="btn-gradient"
            onClick={onProceedToExport}
            disabled={!previewUrl || mediaFailed || isRebuilding}
          >
            <Download className="mr-1.5 h-4 w-4" />Proceed to Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
