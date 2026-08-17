#!/usr/bin/env bash
# One-shot: build image, start container, measure cold-start spin-up latency,
# run the PDF job, and surface the resulting metrics in one place.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="${IMAGE:-playwright-pdf-blob-poc}"
TAG="${IMAGE}:local"
NAME="poc-run-$RANDOM"
PORT="${PORT:-8080}"
HOST_PORT="${HOST_PORT:-8080}"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
OUT="${OUT:-metrics.summary.json}"
RENDER="${RENDER:-1}"

mkdir -p "$DATA_DIR"

echo "==> Building image (first run may take a while)..."
docker build -t "$TAG" . >/dev/null 2>&1 || docker build -t "$TAG" .

IMAGE_ID="$(docker image inspect "$TAG" --format '{{.Id}}' | cut -c8-19)"
IMAGE_BYTES="$(docker image inspect "$TAG" --format '{{.Size}}')"
echo "    image id: $IMAGE_ID  ($(( IMAGE_BYTES / 1024 / 1024 )) MiB)"

echo "==> Starting container and measuring cold-start spin-up..."
START_MS="$(python3 -c 'import time;print(int(time.time()*1000))')"

docker run -d --name "$NAME" \
  -p "${HOST_PORT}:${PORT}" \
  -e PORT="$PORT" \
  -e RENDER="$RENDER" \
  -v "$DATA_DIR":/app/data \
  "$TAG" >/dev/null

# Poll /readyz until the server is accepting requests = external cold-start.
READY_MS=""
SAMPLES=0
MAX_SAMPLES=1200
while [ -z "$READY_MS" ]; do
  SAMPLES=$((SAMPLES+1))
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:${HOST_PORT}/readyz" 2>/dev/null; then
    READY_MS="$(python3 -c 'import time;print(int(time.time()*1000))')"
    break
  fi
  if ! docker ps --filter "name=$NAME" --filter "status=running" | grep -q "$NAME"; then
    echo "!! container exited before readiness" >&2
    docker logs "$NAME" >&2 || true
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    exit 1
  fi
  if [ "$SAMPLES" -ge "$MAX_SAMPLES" ]; then
    echo "!! timed out waiting for readiness" >&2
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    exit 1
  fi
  sleep 0.02
done

SPIN_UP_EXTERNAL_MS=$((READY_MS - START_MS))
echo "    external spin-up (docker run -> /readyz): ${SPIN_UP_EXTERNAL_MS} ms"

# Capture a container-level memory snapshot mid-hold (cold-start RSS).
sleep 0.5
CONTAINER_MEM="$(docker stats --no-stream --format '{{.MemUsage}}' "$NAME" 2>/dev/null || true)"

echo "==> Job done; reading metrics..."
docker wait "$NAME" >/dev/null 2>&1 || true
docker logs "$NAME" 2>&1 | sed -n '/=== PDF BLOB POC METRICS ===/,/metrics written/p'

METRICS_FILE="$DATA_DIR/metrics.json"
if [ -f "$METRICS_FILE" ]; then
  python3 - "$METRICS_FILE" "$SPIN_UP_EXTERNAL_MS" "$IMAGE_BYTES" "$CONTAINER_MEM" "$OUT" <<'PY'
import json, sys
mpath, extMs, imbytes, cmem, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
m = json.load(open(mpath))
m['measurement'] = {
    'externalContainerSpinUpMs': extMs,
    'imageBytes': imbytes,
    'containerMemUsageAtSample': cmem,
}
json.dump(m, open(out, 'w'), indent=2)
print(f"    summary -> {out}")
print("    key metrics:")
cs = m['coldStart']
print(f"      spin-up (app)            : {cs.get('spinUpMs')} ms")
print(f"      RSS at ready (cold-start) : {cs.get('rssMBAtReady')} MB")
mem = m['memory']
print(f"      peak RSS                  : {mem.get('peakRssMB')} MB")
if m.get('job') and not m['job'].get('error'):
    j = m['job']
    print(f"      browser launch           : {j.get('browserLaunchMs')} ms")
    print(f"      render (page->pdf)       : {j.get('renderMs')} ms")
    print(f"      pdf size                 : {j.get('pdfBytes')} B ({j['pdfBytes']/1024:.1f} KiB)")
    dl = j.get('blobDownload', {})
    print(f"      blob download total      : {dl.get('totalBytes')} B in {dl.get('totalMs')} ms ({dl.get('mbPerSec'):.2f} MB/s)")
else:
    print(f"      JOB ERROR               : {m['job'] and m['job'].get('error')}")
PY
else
  echo "!! no metrics.json; job likely failed" >&2
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
echo "==> done"