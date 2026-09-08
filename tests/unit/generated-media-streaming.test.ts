import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import { parseSingleByteRange } from "../../src/lib/http-byte-range";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("generated media byte ranges", () => {
  test("parses bounded and open-ended ranges", () => {
    expect(parseSingleByteRange("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 });
    expect(parseSingleByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseSingleByteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });

  test("implements suffix ranges from the end of the representation", () => {
    expect(parseSingleByteRange("bytes=-500", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseSingleByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  test("rejects malformed, multiple, empty, and unsatisfiable ranges", () => {
    expect(parseSingleByteRange("bytes=", 1000)).toBeNull();
    expect(parseSingleByteRange("bytes=-0", 1000)).toBeNull();
    expect(parseSingleByteRange("bytes=1000-", 1000)).toBeNull();
    expect(parseSingleByteRange("bytes=900-800", 1000)).toBeNull();
    expect(parseSingleByteRange("bytes=0-10,20-30", 1000)).toBeNull();
    expect(parseSingleByteRange("items=0-10", 1000)).toBeNull();
    expect(parseSingleByteRange("bytes=0-0", 0)).toBeNull();
  });
});

describe("generated media route streaming contract", () => {
  test("streams located files instead of buffering the whole generated asset", () => {
    const route = read("src/app/generated/[...path]/route.ts");
    const store = read("src/lib/generated-store.ts");

    expect(route).toContain("locateGeneratedFile");
    expect(route).toContain("createReadStream");
    expect(route).toContain("Readable.toWeb");
    expect(route).toContain("parseSingleByteRange");
    expect(route).not.toContain("readGeneratedFile");
    expect(route).not.toContain("Uint8Array.from");

    expect(store).toContain("export async function locateGeneratedFile");
    expect(store).toContain("await stat(candidate)");
    expect(store).toContain('path.join(STORE_DIR, safe)');
    expect(store).toContain('path.join(process.cwd(), "public", "generated", safe)');
  });

  test("keeps browser seeking headers on partial and unsatisfiable responses", () => {
    const route = read("src/app/generated/[...path]/route.ts");
    expect(route).toContain('"Accept-Ranges": "bytes"');
    expect(route).toContain('status: 206');
    expect(route).toContain('"Content-Range": `bytes ${range.start}-${range.end}/${total}`');
    expect(route).toContain('status: 416');
    expect(route).toContain('"Content-Range": `bytes */${total}`');
  });
});
