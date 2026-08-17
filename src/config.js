'use strict';

const path = require('path');
const fs = require('fs');

// Central config: everything is overridable via environment so the
// benchmark scripts can sweep parameters without editing code.
function getConfig(overrides = {}) {
  const env = process.env;
  const cfg = {
    // --- timing ---
    processStartMs: Date.now(),

    // --- server ---
    port: parseInt(env.PORT || '8080', 10),
    host: env.HOST || '0.0.0.0',

    // --- blob store ---
    // Number of images to "store" in the simulated blob storage.
    numImages: parseInt(env.NUM_IMAGES || '12', 10),
    // Base image dimensions (varied per-image internally).
    imgWidth: parseInt(env.IMG_WIDTH || '400', 10),
    imgHeight: parseInt(env.IMG_HEIGHT || '300', 10),
    imgVariant: env.IMG_VARIANT || 'solid', // solid | gradient

    // --- runtime behaviour ---
    // Render a PDF on startup, then exit (false = stay up as a server only).
    render: (env.RENDER === undefined ? '1' : env.RENDER) !== '0',
    // Simulate downloading every blob image over HTTP (measures blob latency).
    simulateDownloads:
      (env.SIMULATE_DOWNLOADS === undefined ? '1' : env.SIMULATE_DOWNLOADS) !== '0',
    // Keep serving after the job finishes (needed by external profilers).
    stayUp: (env.STAY_UP === undefined ? '0' : env.STAY_UP) !== '0',
    // Optional inbound base URL (defaults to http://host:port).
    externalBaseUrl: env.EXTERNAL_BASE_URL || '',

    // Memory sampler cadence in ms.
    sampleMs: parseInt(env.SAMPLE_MS || '100', 10),

    // --- output ---
    dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),
    pdfFile: env.PDF_FILE || 'output.pdf',

    ...overrides,
  };
  cfg.pdfPath = path.join(cfg.dataDir, cfg.pdfFile);
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  return cfg;
}

module.exports = { getConfig };