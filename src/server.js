'use strict';

const http = require('http');
const { getConfig } = require('./config');
const { MemorySampler } = require('./metrics');
const { BlobStore } = require('./blob-store');
const { buildHtml } = require('./html');
const { renderPdf } = require('./render');
const fs = require('fs');
const path = require('path');

async function main() {
  const cfg = getConfig();
  const sampler = new MemorySampler(cfg.sampleMs);
  sampler.start();

  // Build the simulated blob store first (before the server is "ready") so we
  // can report true cold-start memory with the store loaded but before render.
  const blob = new BlobStore(cfg);
  blob.generate();
  const warmDir = cfg.render ? blob.writeToDisk() : null;

  const baseUrl =
    cfg.externalBaseUrl ||
    `http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${cfg.port}`;

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/readyz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, pid: process.pid }));
    }
    if (url === '/' || url === '/manifest') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(buildHtml(cfg, blob, baseUrl));
    }
    // blob object route: mimics /blob/<variant>/<name> path from blob.blobUrl
    const m = url.match(/^\/blob\/([a-z]+)\/([^/]+)$/);
    if (m) {
      const img = blob.images.find((i) => i.name === m[2]);
      if (!img) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': img.bytes,
        // SAS download header
        'content-disposition': `attachment; filename="${img.name}"`,
        'cache-control': 'no-store',
      });
      return res.end(img.buffer);
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((r) => server.listen(cfg.port, cfg.host, r));
  sampler.mark('server-ready');
  const spinUpMs = Date.now() - cfg.processStartMs;
  const coldStartRssMB = sampler.atMark('server-ready');

  let job = null;
  if (cfg.render) {
    try {
      job = await renderPdf(cfg, blob, baseUrl, sampler);
    } catch (e) {
      job = { error: e.stack || e.message };
    }
  }

  const metrics = {
    version: 1,
    generatedAt: new Date().toISOString(),
    config: {
      numImages: cfg.numImages,
      imgVariant: cfg.imgVariant,
      imgWidth: cfg.imgWidth,
      imgHeight: cfg.imgHeight,
      simulateDownloads: cfg.simulateDownloads,
      render: cfg.render,
      playwright: require('playwright/package.json').version,
      baseUrl,
    },
    coldStart: {
      spinUpMs, // process start -> HTTP server accepting requests
      rssMBAtReady: coldStartRssMB, // cold-start memory (before browser/render)
    },
    job: job || null,
    memory: {
      peakRssMB: sampler.peak(cfg.sampleMs),
      rssNowMB: sampler.rssNow(),
      samplesCount: sampler.samples.length,
    },
  };

  const metricsPath = path.join(cfg.dataDir, 'metrics.json');
  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
  fs.writeFileSync(path.join(cfg.dataDir, 'memory-trace.csv'), sampler.toCSV());

  console.log('=== PDF BLOB POC METRICS ===');
  console.log(JSON.stringify(metrics, null, 2));
  console.log('============================');
  console.log('metrics written to', metricsPath);

  if (!cfg.stayUp) {
    await new Promise((r) => server.close(r));
    sampler.stop();
    process.exit(job && job.error ? 1 : 0);
  }
  // else keep serving so external tools (docker stats, ad-hoc curl) can probe.
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});