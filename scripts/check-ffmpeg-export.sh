#!/usr/bin/env bash
# Validate the exact FFmpeg capabilities Vidora's export pipeline depends on.
set -euo pipefail

for media_bin in ffmpeg ffprobe; do
  if ! command -v "$media_bin" >/dev/null 2>&1; then
    echo "FATAL: $media_bin is required for Vidora video export but is not installed"
    exit 1
  fi
done

FFMPEG_FILTERS="$(ffmpeg -hide_banner -filters 2>&1 || true)"
required_ffmpeg_filters=(
  drawtext xfade concat scale pad setsar fps format
  aresample aformat volume atrim asetpts afade adelay amix
)
for filter_name in "${required_ffmpeg_filters[@]}"; do
  if ! grep -Eq "[[:space:]]${filter_name}[[:space:]]" <<<"$FFMPEG_FILTERS"; then
    echo "FATAL: FFmpeg filter '$filter_name' is unavailable; install a full FFmpeg build before deploying"
    exit 1
  fi
done

FFMPEG_ENCODERS="$(ffmpeg -hide_banner -encoders 2>&1 || true)"
required_ffmpeg_encoders=(libx264 aac libvpx libopus)
for encoder_name in "${required_ffmpeg_encoders[@]}"; do
  if ! grep -Eq "[[:space:]]${encoder_name}[[:space:]]" <<<"$FFMPEG_ENCODERS"; then
    echo "FATAL: FFmpeg encoder '$encoder_name' is unavailable; Vidora cannot provide all advertised export formats"
    exit 1
  fi
done

# A filter/encoder can be listed yet still fail at runtime because of missing
# font libraries, codec linkage, muxers, or incompatible filter support. Run a
# tiny synthetic encode through the same core graph used by Vidora: normalized
# scene inputs + xfade + narration/music-style audio filters + amix. Exercise
# both advertised output families (MP4/H.264/AAC and WebM/VP8/Opus).
FFMPEG_SMOKE_DIR="$(mktemp -d)"
cleanup_ffmpeg_smoke() { rm -rf "$FFMPEG_SMOKE_DIR"; }
trap cleanup_ffmpeg_smoke EXIT
printf '%s\n' 'Vidora' > "$FFMPEG_SMOKE_DIR/title.txt"

if ! ffmpeg -nostdin -hide_banner -loglevel error \
  -f lavfi -i "color=c=black:s=320x180:d=0.1:r=24" \
  -vf "drawtext=textfile='$FFMPEG_SMOKE_DIR/title.txt':expansion=none:fontcolor=white:fontsize=24:x=(w-text_w)/2:y=(h-text_h)/2" \
  -frames:v 1 -f null - >/dev/null 2>&1; then
  echo "FATAL: FFmpeg drawtext runtime probe failed; title-card export would be degraded"
  exit 1
fi

FFMPEG_SMOKE_GRAPH="[0:v]scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[n0];[1:v]scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[n1];[n0][n1]xfade=transition=fade:duration=0.2:offset=0.8[outv];[2:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.500,atrim=duration=0.9,asetpts=PTS-STARTPTS,afade=t=out:st=0.3:d=0.2,adelay=10:all=1[a0];[3:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.300,atrim=duration=0.9,asetpts=PTS-STARTPTS,afade=t=out:st=0.3:d=0.2,adelay=200:all=1[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[aout]"

ffmpeg_smoke_inputs=(
  -f lavfi -i "color=c=black:s=320x180:d=1.2:r=24"
  -f lavfi -i "color=c=gray:s=320x180:d=1.2:r=24"
  -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=1.0"
  -f lavfi -i "sine=frequency=660:sample_rate=44100:duration=1.0"
)

if ! ffmpeg -nostdin -hide_banner -loglevel error -y \
  "${ffmpeg_smoke_inputs[@]}" \
  -filter_complex "$FFMPEG_SMOKE_GRAPH" \
  -map "[outv]" -map "[aout]" \
  -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart \
  -t 1.5 "$FFMPEG_SMOKE_DIR/vidora-smoke.mp4"; then
  echo "FATAL: FFmpeg MP4 smoke encode failed; Vidora H.264/AAC export is not production-ready"
  exit 1
fi
if [[ ! -s "$FFMPEG_SMOKE_DIR/vidora-smoke.mp4" ]]; then
  echo "FATAL: FFmpeg MP4 smoke encode produced no output"
  exit 1
fi

if ! ffmpeg -nostdin -hide_banner -loglevel error -y \
  "${ffmpeg_smoke_inputs[@]}" \
  -filter_complex "$FFMPEG_SMOKE_GRAPH" \
  -map "[outv]" -map "[aout]" \
  -c:v libvpx -crf 32 -b:v 0 -cpu-used 8 \
  -c:a libopus -b:a 96k \
  -t 1.5 "$FFMPEG_SMOKE_DIR/vidora-smoke.webm"; then
  echo "FATAL: FFmpeg WebM smoke encode failed; Vidora VP8/Opus export is not production-ready"
  exit 1
fi
if [[ ! -s "$FFMPEG_SMOKE_DIR/vidora-smoke.webm" ]]; then
  echo "FATAL: FFmpeg WebM smoke encode produced no output"
  exit 1
fi

echo "FFmpeg export capability preflight: OK"
