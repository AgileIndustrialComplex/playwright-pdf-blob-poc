'use strict';

// Builds the HTML that becomes the PDF. Each image is represented as a
// clickable tile: an absolute blob-storage href with a `download` attribute
// (so the PDF holds real download links) plus an inline <img> thumbnail so
// the browser actually fetches/decode the images during render.
function buildHtml(cfg, blob, baseUrl) {
  const tiles = blob.images
    .map((img) => {
      return `
      <div class="tile">
        <img src="${baseUrl}${img.blobUrl}" alt="${img.name}" loading="lazy" />
        <a class="download" href="${baseUrl}${img.blobUrl}" download="${img.name}">⬇ ${img.name}</a>
        <span class="meta">${(img.bytes / 1024).toFixed(1)} KiB</span>
      </div>`;
    })
    .join('\n');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Blob download manifest</title>
  <style>
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; color: #1c2733; }
    h1 { font-size: 20px; }
    .sub { color: #5a6a78; font-size: 12px; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
    .tile { border: 1px solid #dbe2ea; border-radius: 8px; padding: 8px; text-align: center; }
    .tile img { max-width: 100%; border-radius: 4px; }
    .download { display: block; margin-top: 6px; font-size: 12px; color: #0b6bdb; text-decoration: none; }
    .meta { color: #8a97a5; font-size: 11px; }
  </style>
</head>
<body>
  <h1>Blob storage download manifest</h1>
  <p class="sub">${blob.images.length} objects · source: ${baseUrl}/blob · generated ${new Date().toISOString()}</p>
  <div class="grid">
  ${tiles}
  </div>
</body>
</html>`;
}

module.exports = { buildHtml };