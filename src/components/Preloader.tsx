"use client";

import { useEffect, useState } from "react";
import { Clapperboard } from "lucide-react";

/**
 * Vidora Preloader
 * ─────────────────
 * A full-screen overlay shown on first paint (SSR'd so it appears instantly)
 * and dismissed once the app signals it is ready.
 *
 * Motion strategy:
 *  - All core visuals (orbiting dots, logo gradient pulse, progress shimmer,
 *    wordmark gradient sweep) are driven by pure CSS keyframes so they are
 *    guaranteed to animate from the very first paint — no dependency on React
 *    hydration or Framer Motion timing.
 *  - A requestAnimationFrame loop drives a determinate progress counter and
 *    the progress-bar width for a satisfying "fill" feel.
 *
 * Dismiss strategy:
 *  - Listens for the custom `vidora:ready` event (dispatched by page.tsx once
 *    its initial data fetch completes) AND the native `window.load` event.
 *  - Stays visible for at least MIN_DISPLAY ms so the animation is appreciated.
 *  - Hard-capped at MAX_DISPLAY ms as a safety net.
 *  - Fades out via CSS transition (no Framer dependency).
 */

const MIN_DISPLAY = 1200; // ms — minimum time the preloader is visible
const MAX_DISPLAY = 5500; // ms — hard safety cap

export function Preloader() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const start = performance.now();
    let pageLoaded = document.readyState === "complete";
    let appReady = false;
    let finished = false;
    let raf = 0;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;

    const beginFadeOut = () => {
      if (finished) return;
      finished = true;
      setProgress(100);
      // brief pause at 100% so the bar visibly completes, then fade
      finishTimer = setTimeout(() => {
        setFading(true);
        setTimeout(() => setVisible(false), 600);
      }, 260);
    };

    const maybeFinish = () => {
      const elapsed = performance.now() - start;
      const ready = pageLoaded || appReady;
      if (ready && elapsed >= MIN_DISPLAY) {
        beginFadeOut();
      }
    };

    const tick = (now: number) => {
      const elapsed = now - start;
      const ready = pageLoaded || appReady;

      let p: number;
      if (ready) {
        // ready: push toward 100
        p = Math.min(100, 90 + (elapsed / MIN_DISPLAY) * 10);
      } else {
        // waiting: ease toward 88 (never completes until ready signal)
        const t = Math.min(1, elapsed / 1500);
        const eased = 1 - Math.pow(1 - t, 3);
        p = eased * 86;
      }
      setProgress(Math.round(p));

      if (elapsed >= MAX_DISPLAY) {
        beginFadeOut();
      }

      if (!finished) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);

    const onLoad = () => {
      pageLoaded = true;
      // tiny delay so the progress visibly catches up first
      setTimeout(maybeFinish, 60);
    };
    const onReady = () => {
      appReady = true;
      setTimeout(maybeFinish, 60);
    };

    if (pageLoaded) {
      // already loaded (cached / fast nav): schedule a finish check after min display
      setTimeout(maybeFinish, MIN_DISPLAY + 60);
    } else {
      window.addEventListener("load", onLoad);
    }
    window.addEventListener("vidora:ready", onReady);

    return () => {
      cancelAnimationFrame(raf);
      if (finishTimer) clearTimeout(finishTimer);
      window.removeEventListener("load", onLoad);
      window.removeEventListener("vidora:ready", onReady);
    };
  }, []);

  // Lock body scroll while the overlay is on screen
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (visible) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      role="status"
      aria-live="polite"
      className={`preloader-root fixed inset-0 z-[9999] flex items-center justify-center ${fading ? "preloader-fading" : ""}`}
    >
      {/* Background layers */}
      <div className="preloader-bg absolute inset-0" />
      <div className="preloader-orbs absolute inset-0 overflow-hidden">
        <span
          className="orb orb-violet"
          style={{ width: 340, height: 340, top: "12%", left: "8%" }}
        />
        <span
          className="orb orb-rose"
          style={{ width: 300, height: 300, bottom: "8%", right: "6%" }}
        />
        <span
          className="orb orb-amber"
          style={{ width: 220, height: 220, top: "55%", left: "60%" }}
        />
      </div>

      {/* Content */}
      <div className="relative flex flex-col items-center gap-7 px-6">
        {/* Logo + orbiting dots */}
        <div className="preloader-logo-wrap">
          <div className="preloader-orbit">
            <span className="preloader-dot preloader-dot-1" />
            <span className="preloader-dot preloader-dot-2" />
            <span className="preloader-dot preloader-dot-3" />
          </div>
          <div className="preloader-logo">
            <Clapperboard className="h-11 w-11 text-white" strokeWidth={1.75} />
          </div>
          <div className="preloader-ring" />
        </div>

        {/* Wordmark */}
        <div className="text-center">
          <div className="preloader-wordmark">Vidora</div>
          <div className="preloader-tagline">
            Crafting your cinematic experience
          </div>
        </div>

        {/* Progress */}
        <div className="preloader-progress-wrap">
          <div className="preloader-progress-track">
            <div
              className="preloader-progress-fill"
              style={{ width: `${progress}%` }}
            />
            <div className="preloader-progress-shimmer" />
          </div>
          <div className="preloader-progress-meta">
            <span className="preloader-progress-label">Loading</span>
            <span className="preloader-progress-pct">{progress}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
