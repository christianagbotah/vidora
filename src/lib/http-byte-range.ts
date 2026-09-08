export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse one RFC 9110-style byte range against a known representation size.
 *
 * Vidora intentionally supports a single range only because media players use
 * single seek ranges and multipart/byteranges would add substantial response
 * complexity. Invalid, unsatisfiable, or multiple ranges return null so the
 * route can answer 416 with the required `Content-Range: bytes */<size>`.
 */
export function parseSingleByteRange(
  header: string,
  total: number,
): ByteRange | null {
  if (!Number.isSafeInteger(total) || total <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return null;

  // Suffix-byte-range-spec: bytes=-500 means the final 500 bytes, not 0-500.
  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    const length = Math.min(suffixLength, total);
    return { start: total - length, end: total - 1 };
  }

  const start = Number(startRaw);
  if (!Number.isSafeInteger(start) || start < 0 || start >= total) return null;

  if (!endRaw) return { start, end: total - 1 };

  const requestedEnd = Number(endRaw);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;

  return { start, end: Math.min(requestedEnd, total - 1) };
}
