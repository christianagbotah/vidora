"use client";

import React from "react";

interface DeviceSimulatorProps {
  aspectRatio: string;
  children: React.ReactNode;
  className?: string;
  label?: string;
  showLabel?: boolean;
  compact?: boolean;
}

type DeviceType =
  | "phone"
  | "tablet-portrait"
  | "tablet-landscape"
  | "monitor"
  | "ultrawide";

const DEVICE_MAP: Record<string, DeviceType> = {
  "9:16": "phone",
  "1:1": "tablet-portrait",
  "4:3": "tablet-landscape",
  "16:9": "monitor",
  "21:9": "ultrawide",
};

const DEVICE_LABELS: Record<DeviceType, string> = {
  phone: "📱 Phone Preview",
  "tablet-portrait": "📱 Tablet Preview",
  "tablet-landscape": "📱 Tablet Preview",
  monitor: "🖥️ Monitor Preview",
  ultrawide: "🖥️ Ultrawide Preview",
};

function parseAspectRatio(ratio: string): [number, number] {
  const parts = ratio.split(":");
  const w = Math.max(1, parseInt(parts[0], 10) || 16);
  const h = Math.max(1, parseInt(parts[1], 10) || 9);
  return [w, h];
}

export default function DeviceSimulator({
  aspectRatio,
  children,
  className = "",
  label,
  showLabel = true,
  compact = false,
}: DeviceSimulatorProps) {
  const deviceType = DEVICE_MAP[aspectRatio] ?? "monitor";
  const [ratioW, ratioH] = parseAspectRatio(aspectRatio);
  const displayLabel = label ?? DEVICE_LABELS[deviceType];

  const uid = React.useId().replace(/:/g, "");
  const sc = `ds-${uid}`;

  const mH = compact ? 30 : 44;
  const mW = compact ? 64 : 80;
  const dH = compact ? 38 : 56;
  const dW = compact ? 72 : 90;

  const mobileW = `min(${mW}vw, calc(${mH}vh * ${ratioW} / ${ratioH}))`;
  const desktopW = `min(${dW}vw, calc(${dH}vh * ${ratioW} / ${ratioH}))`;

  const phoneBezel = compact ? 6 : 10;
  const tabletBezel = compact ? 8 : 14;
  const monitorSide = compact ? 3 : 5;
  const monitorChin = compact ? 6 : 10;

  return (
    <>
      <style>{`
        .${sc} {
          aspect-ratio: ${ratioW} / ${ratioH};
          width: ${mobileW};
          height: auto;
        }
        @media (min-width: 1024px) {
          .${sc} {
            width: ${desktopW};
          }
        }
      `}</style>

      <div className={`flex flex-col items-center justify-center w-full ${className}`}>
        <div
          className="relative w-full py-6 px-4 lg:py-10 lg:px-8 rounded-2xl overflow-hidden"
          style={{
            background: `
              radial-gradient(circle at 1px 1px, rgba(0,0,0,0.045) 1px, transparent 0),
              linear-gradient(180deg, rgba(248,250,252,0.55) 0%, rgba(226,232,240,0.8) 100%)
            `,
            backgroundSize: "20px 20px, 100% 100%",
          }}
        >
          <div className="relative z-10 flex flex-col items-center gap-3">
            {deviceType === "phone" && (
              <div
                className="relative bg-gradient-to-b from-gray-700 via-gray-800 to-gray-900 rounded-[2.5rem] shadow-[0_25px_60px_-12px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.08]"
                style={{ padding: `${phoneBezel}px` }}
              >
                <div className="absolute -right-[2px] rounded-r-sm bg-gray-600/80" style={{ top: "26%", width: "3px", height: "26px" }} />
                <div className="absolute -right-[2px] rounded-r-sm bg-gray-600/80" style={{ top: "40%", width: "3px", height: "42px" }} />
                <div className="absolute -right-[2px] rounded-r-sm bg-gray-600/80" style={{ top: "58%", width: "3px", height: "26px" }} />
                <div className="absolute -left-[2px] rounded-l-sm bg-gray-600/80" style={{ top: "24%", width: "3px", height: "16px" }} />
                <div className="absolute -left-[2px] rounded-l-sm bg-gray-600/80" style={{ top: "34%", width: "3px", height: "34px" }} />
                <div className="absolute -left-[2px] rounded-l-sm bg-gray-600/80" style={{ top: "52%", width: "3px", height: "34px" }} />
                <div className="absolute left-1/2 -translate-x-1/2 bg-black rounded-full z-20" style={{ top: `${phoneBezel + 2}px`, width: compact ? "66px" : "86px", height: compact ? "16px" : "22px" }} />
                <div className={`${sc} relative overflow-hidden bg-black`} style={{ borderRadius: "1.75rem" }}>{children}</div>
                <div className="absolute left-1/2 -translate-x-1/2 bg-white/20 rounded-full" style={{ bottom: `${phoneBezel - 2}px`, width: compact ? "76px" : "100px", height: "4px" }} />
              </div>
            )}

            {(deviceType === "tablet-portrait" || deviceType === "tablet-landscape") && (
              <div
                className="relative bg-gradient-to-b from-gray-600 to-gray-800 rounded-[1.25rem] shadow-[0_20px_50px_-10px_rgba(0,0,0,0.45)] ring-1 ring-white/[0.06]"
                style={{ padding: `${tabletBezel}px` }}
              >
                <div className="absolute left-1/2 -translate-x-1/2 w-[6px] h-[6px] bg-gray-900 rounded-full z-20 ring-1 ring-gray-500/50" style={{ top: "5px" }} />
                <div className={`${sc} relative overflow-hidden bg-black`} style={{ borderRadius: "0.3rem" }}>{children}</div>
              </div>
            )}

            {(deviceType === "monitor" || deviceType === "ultrawide") && (
              <div className="flex flex-col items-center">
                <div
                  className="relative bg-gradient-to-b from-gray-600 to-gray-800 rounded-lg shadow-[0_25px_60px_-12px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.06]"
                  style={{ paddingTop: `${monitorSide}px`, paddingLeft: `${monitorSide}px`, paddingRight: `${monitorSide}px`, paddingBottom: `${monitorChin}px` }}
                >
                  <div className="absolute left-1/2 -translate-x-1/2 w-[5px] h-[5px] bg-gray-500 rounded-full z-20" style={{ top: "2px" }} />
                  <div className={`${sc} relative overflow-hidden bg-black`} style={{ borderRadius: "0.2rem" }}>{children}</div>
                </div>
                <div className="bg-gradient-to-b from-gray-700 to-gray-600 -mt-px" style={{ width: compact ? "28px" : "44px", height: compact ? "16px" : "26px", clipPath: "polygon(15% 0%, 85% 0%, 100% 100%, 0% 100%)" }} />
                <div className="bg-gradient-to-b from-gray-600 to-gray-500 rounded-full shadow-lg shadow-black/20" style={{ width: compact ? "72px" : "110px", height: compact ? "5px" : "7px" }} />
              </div>
            )}

            {showLabel && (
              <p className="font-medium text-slate-400 select-none tracking-wide" style={{ fontSize: compact ? "0.65rem" : "0.8rem" }}>{displayLabel}</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
