# Base image already bundles the correct Playwright Chromium revision.
# Keep the npm `playwright` version in package.json in lock-step with this tag.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

ENV NODE_ENV=production
WORKDIR /app

# Install deps first for better Docker layer caching.
COPY package.json package-lock.json* ./
RUN npm install --production --no-audit --no-fund

COPY src ./src
COPY scripts ./scripts

# Runtime data / metrics output (mount a volume here to persist results).
ENV DATA_DIR=/app/data
RUN mkdir -p "$DATA_DIR"

EXPOSE 8080

HEALTHCHECK --interval=2s --timeout=2s --start-period=1s --retries=30 \
  CMD node -e "http=require('http');http.get('http://127.0.0.1:8080/readyz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" || exit 1

CMD ["node", "src/server.js"]