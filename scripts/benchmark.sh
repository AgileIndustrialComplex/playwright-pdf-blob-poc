#!/usr/bin/env bash
# Cold-start benchmark: run the full container lifecycle N times (each run
# starts from a fresh container, i.e. a true cold start of the app process),
# then aggregate spin-up time and memory across runs into a CSV + summary.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUNS="${RUNS:-5}"
PORT_BASE="${PORT_BASE:-8090}"
IMAGE="${IMAGE:-playwright-pdf-blob-poc}"
TAG="${IMAGE}:local"
BENCH_DIR="${BENCH_DIR:-$ROOT/data/bench}"
mkdir -p "$BENCH_DIR"

echo ">> Building image once..."
docker build -t "$TAG" . >/dev/null 2>&1 || docker build -t "$TAG" .
IMAGE_SIZE="$(docker image inspect "$TAG" --format '{{.Size}}')"

echo ">> Running ${RUNS} cold starts (fresh container + app process each)..."
CSV="$BENCH_DIR/coldstart.csv"
echo "run,spinUpExternalMs,spinUpAppMs,rssAtReadyMB,peakRssMB,browserLaunchMs,renderMs,pdfBytes,imageBytes" > "$CSV"

MERGED="{}"
for i in $(seq 1 "$RUNS"); do
  HOST_PORT=$((PORT_BASE + i))
  DATA="$BENCH_DIR/run-$i"
  mkdir -p "$DATA"

  START_MS="$(python3 -c 'import time;print(int(time.time()*1000))')"
  NAME="poc-bench-$RANDOM"
  docker run -d --name "$NAME" -p "${HOST_PORT}:8080" -v "$DATA":/app/data "$TAG" >/dev/null

  READY_MS=""; SAMPLES=0
  while [ -z "$READY_MS" ]; do
    SAMPLES=$((SAMPLES+1))
    if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:${HOST_PORT}/readyz" 2>/dev/null; then
      READY_MS="$(python3 -c 'import time;print(int(time.time()*1000))')"
      break
    fi
    if ! docker ps --filter "name=$NAME" --filter "status=running" | grep -q "$NAME"; then break; fi
    [ "$SAMPLES" -ge 1200 ] && break
    sleep 0.02
  done
  SPIN_EXT=$((READY_MS - START_MS))

  docker wait "$NAME" >/dev/null 2>&1 || true

  if [ -f "$DATA/metrics.json" ]; then
    SPIN_APP="$(python3 -c "import json;print(json.load(open('$DATA/metrics.json'))['coldStart']['spinUpMs'])")"
    RSS="$(python3 -c "import json;print(json.load(open('$DATA/metrics.json'))['coldStart']['rssMBAtReady'])")"
    PEAK="$(python3 -c "import json;print(json.load(open('$DATA/metrics.json'))['memory']['peakRssMB'])")"
    J="$(python3 -c "import json;m=json.load(open('$DATA/metrics.json'));print(json.dumps(m['job'])if m.get('job')and not m['job'].get('error')else json.dumps({}))")"
    BL="$(echo "$J" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('browserLaunchMs',''))")"
    RD="$(echo "$J" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('renderMs',''))")"
    PB="$(echo "$J" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('pdfBytes',''))")"
  else
    SPIN_APP=""; RSS=""; PEAK=""; BL=""; RD=""; PB=""
  fi
  echo "$i,$SPIN_EXT,$SPIN_APP,$RSS,$PEAK,$BL,$RD,$PB,$IMAGE_SIZE" >> "$CSV"
  echo "   run $i: external spin-up ${SPIN_EXT} ms | rss@ready ${RSS} MB | peak ${PEAK} MB | render ${RD} ms"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
done

echo ""
echo "== Aggregate (cold-start latency, N=$RUNS) =="
python3 - "$CSV" <<'PY'
import csv, sys
rows = list(csv.DictReader(open(sys.argv[1])))
def agg(col):
    vals = [float(r[col]) for r in rows if (r.get(col) or '') not in ('', 'None')]
    if not vals: return 'n/a'
    mn = min(vals); mx = max(vals); mean = sum(vals)/len(vals)
    return f"min={mn:.0f} mean={mean:.0f} max={mx:.0f}"
for c,label in [('spinUpExternalMs','external container spin-up (ms)'),
                ('spinUpAppMs','app-reported spin-up (ms)'),
                ('rssAtReadyMB','rss at ready (MB)'),
                ('peakRssMB','peak rss (MB)'),
                ('renderMs','render time (ms)')]:
    print(f"  {label:34}: {agg(c)}")
print(f"\nCSV: {sys.argv[1]}")
PY