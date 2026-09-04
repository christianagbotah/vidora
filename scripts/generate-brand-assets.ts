/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora Studio — Brand Asset Generator
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  Single source of truth for the Vidora brand mark (the header logo:
 *  violet→fuchsia gradient tile + white clapperboard) and all derived
 *  raster assets:
 *
 *    public/logo.svg             64×64  master mark (hand-maintained twin)
 *    public/favicon-32.png       32×32  browser tab favicon
 *    public/icon-192.png         192×192 PWA / shortcut icon
 *    public/icon-512.png         512×512 PWA hi-res icon
 *    public/icon-512-mask.png    512×512 PWA maskable (full-bleed, safe zone)
 *    public/apple-icon.png       180×180 Apple touch icon
 *    public/images/og-image.png  1200×630 social share card (OG / Twitter)
 *
 *  Usage:  bun scripts/generate-brand-assets.ts
 *  Re-run after changing the mark; commit the outputs.
 * ───────────────────────────────────────────────────────────────────────────
 */
import sharp from "sharp";
import { writeFile } from "fs/promises";
import path from "path";

// ── Brand constants (mirror src/app/page.tsx header) ────────────────────────
const VIOLET = "#8b5cf6";   // tailwind violet-500
const FUCHSIA = "#d946ef";  // tailwind fuchsia-500

// Lucide "clapperboard" icon paths (24×24 stroke grid) — the header mark
const CLAPPERBOARD = `
    <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/>
    <path d="m6.2 5.3 3.1 3.9"/>
    <path d="m12.4 3.4 3.1 4"/>
    <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>`;

/** The brand mark at any pixel size. `iconPct` = clapperboard share of tile. */
function markSvg(size: number, opts: { radiusPct?: number; iconPct?: number } = {}): string {
  const radiusPct = opts.radiusPct ?? 0.22;
  const iconPct = opts.iconPct ?? 0.58;
  const scale = (size * iconPct) / 24;
  const offset = (size - 24 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${VIOLET}"/>
      <stop offset="1" stop-color="${FUCHSIA}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${Math.round(size * radiusPct)}" fill="url(#g)"/>
  <g transform="translate(${offset.toFixed(2)} ${offset.toFixed(2)}) scale(${scale.toFixed(4)})" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CLAPPERBOARD}
  </g>
</svg>`;
}

/** 1200×630 social share card: dark gradient, mark, wordmark, tagline, URL. */
function ogSvg(): string {
  const mark = markSvg(132);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0b0614"/>
      <stop offset="1" stop-color="#1c0b2e"/>
    </linearGradient>
    <radialGradient id="glowV" cx="0.25" cy="0.3" r="0.5" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="${VIOLET}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${VIOLET}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowF" cx="0.8" cy="0.8" r="0.45" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="${FUCHSIA}" stop-opacity="0.3"/>
      <stop offset="1" stop-color="${FUCHSIA}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="word" x1="300" y1="0" x2="940" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#a78bfa"/>
      <stop offset="1" stop-color="#e879f9"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glowV)"/>
  <rect width="1200" height="630" fill="url(#glowF)"/>

  <!-- Brand lockup: mark + wordmark, centered -->
  <g transform="translate(214 249)">
    ${mark.replace('<svg xmlns="http://www.w3.org/2000/svg" width="132" height="132" viewBox="0 0 132 132">', '<svg width="132" height="132" viewBox="0 0 132 132">')}
    <text x="176" y="64" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="76" font-weight="bold" fill="url(#word)">Vidora Studio</text>
    <text x="180" y="112" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="28" fill="#b5a8d6">Professional AI Video Creator</text>
  </g>

  <text x="600" y="575" text-anchor="middle" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="22" fill="#8d7fb0">vidora.lightworldtech.com</text>
</svg>`;
}

async function pngFrom(svg: string, out: string, width?: number, height?: number) {
  let pipeline = sharp(Buffer.from(svg)).png({ compressionLevel: 9 });
  if (width && height) pipeline = pipeline.resize(width, height);
  await pipeline.toFile(out);
  console.log(`  ✓ ${path.relative(process.cwd(), out)}`);
}

async function main() {
  console.log("Generating Vidora Studio brand assets…");

  // Keep public/logo.svg in sync with this script's mark definition
  await writeFile("public/logo.svg", markSvg(64).replace("<svg ", '<?xml version="1.0" encoding="UTF-8"?>\n<svg ') + "\n", "utf8");
  console.log("  ✓ public/logo.svg");

  await pngFrom(markSvg(32, { radiusPct: 0.24, iconPct: 0.62 }), "public/favicon-32.png");
  await pngFrom(markSvg(192), "public/icon-192.png");
  await pngFrom(markSvg(512), "public/icon-512.png");
  // Maskable: full-bleed square (no transparent rounded corners), icon in the
  // 80% safe zone so Android adaptive masks never clip the clapperboard.
  await pngFrom(markSvg(512, { radiusPct: 0, iconPct: 0.5 }), "public/icon-512-mask.png");
  await pngFrom(markSvg(180, { radiusPct: 0.22 }), "public/apple-icon.png");
  await pngFrom(ogSvg(), "public/images/og-image.png", 1200, 630);

  console.log("Done. Commit the outputs (public/).");
}

main().catch((err) => {
  console.error("Asset generation failed:", err);
  process.exit(1);
});
