# Sandbox image: runs the Playwright game check on AI-generated code.
# Build from the repository root AFTER `npm run build` (see `npm run sandbox:build`):
#   docker build -f deploy/sandbox/Dockerfile -t gamecreator-sandbox:pw1.60.0 .
#
# The base image tag, PLAYWRIGHT_VERSION and apps/api/src/sandbox/docker-args.ts
# (SANDBOX_PLAYWRIGHT_VERSION) must all name the same Playwright version; a unit
# test checks them against package-lock.json. Update procedure: deploy/README.md.
ARG PLAYWRIGHT_VERSION=1.60.0
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG PLAYWRIGHT_VERSION=1.60.0
ARG ZOD_VERSION=4.6.7

# Only what the runner needs: no source, no .env, no tests (see .dockerignore).
WORKDIR /opt/gc
RUN npm install --no-audit --no-fund --ignore-scripts --omit=dev \
      playwright@${PLAYWRIGHT_VERSION} zod@${ZOD_VERSION} \
 && npm cache clean --force
COPY packages/contracts/package.json node_modules/@game-creator/contracts/package.json
COPY packages/contracts/dist node_modules/@game-creator/contracts/dist
COPY apps/api/package.json apps/api/package.json
COPY apps/api/dist apps/api/dist
COPY apps/web/public/runtime/advanced.js apps/web/public/runtime/advanced.js

# Read-only for everyone, owned by root: the job user cannot alter the runner.
RUN chmod -R a=rX /opt/gc

LABEL gamecreator.sandbox.image="1" playwright.version="${PLAYWRIGHT_VERSION}"
ENV NODE_ENV=production \
    HOME=/tmp
USER 10001:10001
ENTRYPOINT ["node", "/opt/gc/apps/api/dist/sandbox/runner-main.js"]
