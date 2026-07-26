/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Watermark Engine
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  Applies a visible, hard-to-remove "VIDORA • PREVIEW" watermark to free
 *  preview images so they cannot be used as a final product. Users must buy
 *  tokens to generate the clean, full-HD, unwatermarked version.
 *
 *  Strategy:
 *   1. Downscale to max 768px (preview quality, not usable for production)
 *   2. Composite an SVG overlay with:
 *      - Diagonal repeating "VIDORA • PREVIEW" text (low opacity, tiled)
 *      - A solid top-left "VIDORA" badge
 *      - A bottom-right "PREVIEW" banner with call-to-action
 *   3. Output as JPEG (quality 80) — smaller than PNG, good enough for preview
 *
 *  Uses sharp (already a dependency) for fast, native image processing.
 * ───────────────────────────────────────────────────────────────────────────
 */

import sharp from "sharp";

const MAX_PREVIEW_DIMENSION = 768;

/**
 * Build the SVG watermark overlay sized to the target image dimensions.
 * The overlay is semi-transparent so the underlying image is still visible,
 * but the repeated diagonal text makes it impossible to crop out cleanly.
 */
function buildWatermarkSvg(width: number, height: number): Buffer {
  const diagonalText = "VIDORA • PREVIEW • VIDORA • PREVIEW • ";
  // Repeat enough times to cover the diagonal of the image
  const diagonal = Math.ceil(Math.sqrt(width * width + height * height));
  const repeats = Math.ceil(diagonal / 220) + 1;
  const fullLine = diagonalText.repeat(repeats).slice(0, diagonal + 200);

  // Font size scales with image size but stays readable
  const fontSize = Math.max(16, Math.round(Math.min(width, height) / 22));
  const lineHeight = fontSize * 2.4;

  // How many diagonal lines needed to tile vertically
  const lineCount = Math.ceil((height + width) / lineHeight) + 2;

  // Build diagonal lines, each offset so they tile the canvas
  const lines: string[] = [];
  for (let i = -1; i < lineCount; i++) {
    const y = i * lineHeight;
    // Alternate text start so the pattern doesn't look too uniform
    const offset = (i % 2) * (fontSize * 1.2);
    lines.push(
      `<text x="${-offset}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="rgba(255,255,255,0.22)" transform="rotate(-30 ${-offset} ${y})" letter-spacing="2">${escapeXml(fullLine)}</text>`
    );
  }

  // Top-left badge: "VIDORA"
  const badgeFontSize = Math.max(13, Math.round(fontSize * 0.7));
  const badgeW = badgeFontSize * 6.2;
  const badgeH = badgeFontSize * 2.4;

  // Bottom-right banner: "PREVIEW — buy tokens to unlock HD"
  const bannerFontSize = Math.max(12, Math.round(fontSize * 0.62));
  const bannerW = bannerFontSize * 22;
  const bannerH = bannerFontSize * 2.6;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <!-- Diagonal repeating watermark text -->
  <g>${lines.join("\n  ")}</g>

  <!-- Top-left VIDORA badge -->
  <g transform="translate(${badgeFontSize * 0.8} ${badgeFontSize * 0.8})">
    <rect x="0" y="0" width="${badgeW}" height="${badgeH}" rx="${badgeH / 3}" fill="rgba(124,58,237,0.92)" />
    <text x="${badgeW / 2}" y="${badgeH / 2 + badgeFontSize * 0.35}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${badgeFontSize}" font-weight="800" fill="#ffffff" letter-spacing="1">VIDORA</text>
  </g>

  <!-- Bottom-right PREVIEW banner -->
  <g transform="translate(${width - bannerW - bannerFontSize * 0.8} ${height - bannerH - bannerFontSize * 0.8})">
    <rect x="0" y="0" width="${bannerW}" height="${bannerH}" rx="${bannerH / 4}" fill="rgba(0,0,0,0.78)" />
    <text x="${bannerW / 2}" y="${bannerH / 2 + bannerFontSize * 0.32}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${bannerFontSize}" font-weight="700" fill="#fbbf24" letter-spacing="0.5">PREVIEW • buy tokens for HD</text>
  </g>
</svg>`;

  return Buffer.from(svg);
}

/** Escape XML special characters in watermark text. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Apply the Vidora watermark to an image buffer.
 *
 * @param imageBuffer Source image (PNG/JPEG base64-decoded buffer)
 * @returns Watermarked JPEG buffer, downscaled to max 768px
 */
export async function applyWatermark(imageBuffer: Buffer): Promise<Buffer> {
  // First, get metadata to know the dimensions after downscale
  const metadata = await sharp(imageBuffer).metadata();
  const origW = metadata.width ?? MAX_PREVIEW_DIMENSION;
  const origH = metadata.height ?? MAX_PREVIEW_DIMENSION;

  // Compute downscale so the longest side is <= MAX_PREVIEW_DIMENSION
  const scale = Math.min(1, MAX_PREVIEW_DIMENSION / Math.max(origW, origH));
  const targetW = Math.round(origW * scale);
  const targetH = Math.round(origH * scale);

  // Build the watermark SVG sized to the downscaled image
  const watermarkSvg = buildWatermarkSvg(targetW, targetH);

  // Resize → composite watermark → output JPEG
  return sharp(imageBuffer)
    .resize(targetW, targetH, { fit: "inside", withoutEnlargement: true })
    .composite([
      {
        input: watermarkSvg,
        top: 0,
        left: 0,
        blend: "over",
      },
    ])
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}
