"use client";

import React from "react";
import { AlertTriangle, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[ErrorBoundary] Caught render error:", error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 bg-background">
          <div className="relative w-full max-w-md">
            {/* Glass card container */}
            <div className="relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl overflow-hidden">
              {/* Gradient accent bar at top */}
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-violet-500" />

              {/* Decorative glow behind icon */}
              <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

              <div className="relative p-8 flex flex-col items-center text-center gap-6">
                {/* Error icon with gradient ring */}
                <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 ring-1 ring-violet-500/30">
                  <AlertTriangle className="h-10 w-10 text-violet-400" />
                </div>

                {/* Error message */}
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold text-foreground tracking-tight">
                    Something went wrong
                  </h2>
                  <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                    An unexpected error occurred. This has been logged for
                    investigation. Please try reloading the page.
                  </p>
                </div>

                {/* Error details (truncated) */}
                {this.state.error?.message && (
                  <div className="w-full rounded-lg bg-black/20 border border-white/5 p-3 max-h-24 overflow-y-auto">
                    <p className="text-xs font-mono text-muted-foreground break-all leading-relaxed">
                      {this.state.error.message}
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full">
                  <Button
                    onClick={this.handleReload}
                    className="w-full sm:w-auto bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white shadow-lg shadow-violet-500/25 cursor-pointer"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Reload
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto border-white/10 hover:bg-white/5 cursor-pointer"
                    onClick={() => {
                      console.error(
                        "[ErrorBoundary] User-reported error:",
                        this.state.error
                      );
                    }}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Report Issue
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
