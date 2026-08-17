# Playwright PDF + Blob Storage PoC (Docker)

A dependency-light proof of concept for **measuring** a "PDF in a container"
workflow built on Playwright:

- Spins up a Docker container.
- The app simulates blob storage (N generated PNGs served with SAS-style URLs
  and `Content-Disposition: attachment` headers).
- Playwright renders an HTML **download manifest** to a real PDF, where every
  image is both a clickable **download link** (blob URL + `download` attr) and
  an inline thumbnail.
- It **measures the run**: cold-start spin-up time, cold-start memory, browser
  launch, blob download latency/throughput, render time, PDF size, and peak RSS.

## Layout

```
src/
  config.js     # env-driven config
  png.js        # zero-dependency PNG encoder (solid / gradient fixtures)
  blob-store.js # simulated blob storage (generates + serves images)
  html.js       # builds the download-manifest HTML
  render.js     # Playwright: browser launch, blob download sim, HTML->PDF
  metrics.js    # RSS sampler (/proc/self/status) with timeline
  server.js     # entrypoint: HTTP server + job orchestration
scripts/
  run.sh        # one-shot: build, run, measure, print metrics
  benchmark.sh  # N cold-start runs -> aggregated summary + CSV
Dockerfile      # mcr.microsoft.com/playwright:v1.49.1-jammy
```

## Quick start

```bash
# One-shot run: build image, start container, generate PDF, print all metrics
./scripts/run.sh

# Cold-start benchmark: N=5 fresh-container runs, aggregated latency + memory
RUNS=5 ./scripts/benchmark.sh
```

Output lands in `./data/`:

| artifact | contents |
|----------|----------|
| `data/output.pdf` | generated PDF (clickable blob download links) |
| `data/metrics.json` | full metrics payload |
| `data/metrics.summary.json` | metrics + externally measured spin-up & image size |
| `data/memory-trace.csv` | per-sample RSS timeline (`t_ms,rss_mb,mark`) |
| `data/bench/coldstart.csv` | per-run aggregate across the benchmark sweep |

## Metrics

Each run reports:

- **cold-start spin-up** — app-reported (process start → HTTP server accepting
  requests) and external (`docker run` → first `/readyz` 200).
- **cold-start memory** — process RSS at the moment the server is ready, before
  the browser / render starts.
- **browser launch** — `chromium.launch()` wall time.
- **blob downloads** — per-image latency, bytes, aggregate throughput (MB/s).
- **render** — `setContent(html)` → PDF bytes.
- **PDF size**, **peak RSS**, and a full **RSS timeline** CSV.

### Verify/download items yourself

```bash
# health probe
curl -s http://127.0.0.1:8080/readyz
# the HTML manifest (what becomes the PDF)
curl -s http://127.0.0.1:8080/manifest
# download a blob object directly
curl -OJ http://127.0.0.1:8080/blob/solid/img-01.png?sv=2020-08-04&sp=r&sig=x
```

## Configuration (env)

| var | default | purpose |
|-----|---------|---------|
| `NUM_IMAGES` | `12` | blob objects to generate/serve |
| `IMG_WIDTH`/`IMG_HEIGHT` | `400`/`300` | base image size |
| `IMG_VARIANT` | `solid` | `solid` or `gradient` fixture style |
| `RENDER` | `1` | render + exit; `0` = serve only |
| `SIMULATE_DOWNLOADS` | `1` | measure blob download latency |
| `STAY_UP` | `0` | keep serving after the job (for external profiling) |
| `SAMPLE_MS` | `100` | RSS sampler cadence |
| `DATA_DIR` | `/app/data` | output volume |
| `PORT` / `HOST_PORT` | `8080` | container / host port |
| `RUNS` | `5` | benchmark sweep size |

> **Version coupling:** the npm `playwright` version in `package.json` must
> match the browser revision bundled in the base image tag. Both are pinned to
> **1.49.1** here — bump them together.

## Notes on what "cold start" means here

Since the browser is bundled in the base image, a *container* cold start still
pays for: image pull (first time), container runtime, Node boot, blob-store
generation, HTTP bind — before any browser/render cost. The benchmark separates
**server-ready** (pure app cold start) from **browser launch** and **render** so
you can see how each phase scales (e.g. with `NUM_IMAGES`).

## Requirements

- Docker (tested: 28.x)
- `curl`, `python3`, `bash`