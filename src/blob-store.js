'use strict';

const { makePng } = require('./png');
const fs = require('fs');
const path = require('path');

// Simulated blob storage: generates N images on startup and serves them over
// an HTTP endpoint that mimics blob-storage semantics (a SAS-style URL plus a
// Content-Disposition attachment header so clicked links trigger a download).
class BlobStore {
  constructor(cfg) {
    this.cfg = cfg;
    this.images = []; // [{name, buffer, bytes}]
  }

  generate() {
    const { numImages, imgWidth: w, imgHeight: h, imgVariant } = this.cfg;
    this.images = [];
    for (let i = 0; i < numImages; i++) {
      // Deterministic per-index colour so each image differs in bytes.
      const r = (i * 47) % 256;
      const g = (i * 123 + 40) % 256;
      const b = (i * 89 + 200) % 256;
      const sizeMul = 0.6 + ((i * 0.15) % 0.8); // vary dimensions
      const width = Math.max(64, Math.round(w * sizeMul));
      const height = Math.max(64, Math.round(h * sizeMul));
      const buffer = makePng(width, height, [r, g, b], imgVariant);
      this.images.push({
        name: `img-${String(i + 1).padStart(2, '0')}.png`,
        buffer,
        bytes: buffer.length,
        blobUrl: `/blob/${imgVariant}/${String(i + 1).padStart(2, '0')}.png?sv=2020-08-04&sp=r&sig=FAKE-SAS-${i}${(i * 7) % 100}`,
      });
    }
    return this.images;
  }

  writeToDisk() {
    const dir = path.join(this.cfg.dataDir, 'blob-warm');
    fs.mkdirSync(dir, { recursive: true });
    for (const img of this.images) {
      fs.writeFileSync(path.join(dir, img.name), img.buffer);
    }
    return dir;
  }
}

module.exports = { BlobStore };