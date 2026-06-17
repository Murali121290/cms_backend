# ─── S4Carlisle CMS Frontend — Two-Stage Dockerfile ─────────────────────────
#
# Stage 1: Build the React/Vite app
# Stage 2: Serve the built assets (for use in CI or standalone container)
#
# The primary production deployment mounts the built dist/ directory into the
# main nginx container directly (see docker-compose.yml nginx service).
# This Dockerfile is provided for CI pipelines or alternative container-based
# deployment strategies.
#
# Build locally:
#   docker build -t cms-frontend ./frontend
#
# Build with a custom base path (matches vite.config.ts logic):
#   docker build --build-arg MODE=production -t cms-frontend ./frontend

# ── Stage 1: Node build ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer is cached unless package files change)
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: nginx to serve built assets ─────────────────────────────────────
FROM nginx:alpine AS runtime

# Copy the Vite build output into the path nginx expects
COPY --from=builder /app/dist /var/www/ui

# Minimal nginx config: serve SPA with React Router fallback.
# In the full stack, the main nginx container handles /ui/ routing.
# This config is for when the frontend container is used standalone.
RUN printf 'server {\n\
    listen 80;\n\
    root /var/www/ui;\n\
    \n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
    \n\
    location = /index.html {\n\
        expires -1;\n\
        add_header Cache-Control "no-store, no-cache, must-revalidate";\n\
    }\n\
    \n\
    location = /health {\n\
        access_log off;\n\
        return 200 "ok";\n\
        add_header Content-Type text/plain;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost/health || exit 1
