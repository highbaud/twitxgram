# Official Playwright image ships Chromium + all its system deps.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

# Color-emoji font — without this, emoji render as tofu on headless Linux.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install prod deps first (layer cache).
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3030
EXPOSE 3030

# Drop to the non-root user the Playwright image provides.
USER pwuser

CMD ["node", "src/server.js"]
