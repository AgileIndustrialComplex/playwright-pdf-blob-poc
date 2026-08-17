'use strict';

const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');
const { buildHtml } = require('./html');

// Render the HTML manifest page to a PDF with Playwright. Also (optionally)
// simulates a "download all images" pass over HTTP to measure blob latency.
async function renderPdf(cfg, blob, baseUrl, sampler) {
  const result = {};

  // --- browser cold start ---
  let t = Date.now();
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  result.browserLaunchMs = Date.now() - t;
  sampler.mark('browser-launched');

  const context = await browser.newContext();
  const page = await context.newPage();

  // --- simulated blob downloads (measures storage read latency) ---
  if (cfg.simulateDownloads) {
    result.blobDownload = await downloadAll(cfg, blob, baseUrl);
  } else {
    result.blobDownload = { images: [], totalBytes: 0, totalMs: 0, mbPerSec: 0 };
  }

  // --- render HTML -> PDF ---
  const html = buildHtml(cfg, blob, baseUrl);
  t = Date.now();
  await page.setContent(html, { waitUntil: 'networkidle' });
  sampler.mark('page-loaded');
  const pdf = await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true });
  result.renderMs = Date.now() - t;
  sampler.mark('pdf-rendered');

  fs.writeFileSync(cfg.pdfPath, pdf);
  result.pdfBytes = fs.statSync(cfg.pdfPath).size;
  result.pdfFile = cfg.pdfPath;

  await browser.close();
  sampler.mark('browser-closed');

  return result;
}

function downloadAll(cfg, blob, baseUrl) {
  return new Promise((resolve) => {
    const report = { images: [], totalBytes: 0, totalMs: 0, mbPerSec: 0 };
    let i = 0;
    const startAll = Date.now();

    const next = () => {
      if (i >= blob.images.length) {
        const totalMs = Date.now() - startAll;
        report.totalMs = totalMs;
        report.mbPerSec =
          totalMs > 0 ? report.totalBytes / (1024 * 1024) / (totalMs / 1000) : 0;
        return resolve(report);
      }
      const img = blob.images[i++];
      const s = Date.now();
      http
        .get(baseUrl + img.blobUrl, (res) => {
          let buf = [];
          res.on('data', (c) => buf.push(c));
          res.on('end', () => {
            const bytes = Buffer.concat(buf).length;
            report.totalBytes += bytes;
            report.images.push({
              name: img.name,
              bytes,
              ms: Date.now() - s,
              status: res.statusCode,
            });
            next();
          });
        })
        .on('error', (e) => {
          report.images.push({ name: img.name, bytes: 0, ms: Date.now() - s, status: `ERR:${e.code}` });
          next();
        });
    };
    next();
  });
}

module.exports = { renderPdf, downloadAll };