from pathlib import Path

path = Path("src/lib/full-preview-render.ts")
text = path.read_text(encoding="utf-8")
old = '''function buildAudioFilter(layers: AudioLayer[]): string {\n  const filters: string[] = [];\n  const labels: string[] = [];\n  layers.forEach((layer, index) => {\n    const pieces = [\n      `[${layer.inputIndex}:a]`,\n      layer.trimTo ? `atrim=0:${layer.trimTo.toFixed(3)}` : "",\n      "asetpts=PTS-STARTPTS",\n      `volume=${layer.volume.toFixed(4)}`,\n      layer.fadeOut && layer.trimTo\n        ? `afade=t=out:st=${Math.max(0, layer.trimTo - Math.min(1.2, layer.trimTo / 3)).toFixed(3)}:d=${Math.min(1.2, layer.trimTo / 3).toFixed(3)}`\n        : "",\n      `adelay=${layer.startMs}|${layer.startMs}`,\n      `[a${index}]`,\n    ].filter(Boolean).join(",");\n    filters.push(pieces);\n    labels.push(`[a${index}]`);\n  });\n  filters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0[aout]`);\n  return filters.join(";");\n}\n'''
new = '''function buildAudioFilter(layers: AudioLayer[]): string {\n  const filters: string[] = [];\n  const labels: string[] = [];\n  layers.forEach((layer, index) => {\n    const operations = [\n      layer.trimTo ? `atrim=0:${layer.trimTo.toFixed(3)}` : "",\n      "asetpts=PTS-STARTPTS",\n      `volume=${layer.volume.toFixed(4)}`,\n      layer.fadeOut && layer.trimTo\n        ? `afade=t=out:st=${Math.max(0, layer.trimTo - Math.min(1.2, layer.trimTo / 3)).toFixed(3)}:d=${Math.min(1.2, layer.trimTo / 3).toFixed(3)}`\n        : "",\n      `adelay=${layer.startMs}|${layer.startMs}`,\n    ].filter(Boolean);\n    const output = `a${index}`;\n    filters.push(`[${layer.inputIndex}:a]${operations.join(",")}[${output}]`);\n    labels.push(`[${output}]`);\n  });\n  filters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0[aout]`);\n  return filters.join(";");\n}\n'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected one buildAudioFilter block, found {count}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("corrected FFmpeg audio filter graph syntax")
