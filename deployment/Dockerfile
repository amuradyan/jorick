FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Best-effort BGE pre-cache. If the build sandbox can reach HuggingFace, this
# populates ~1.3 GB into the image and the named volume seeds from it on first
# mount. If the network is unreachable, mcp-search downloads at runtime into
# the persisted /app/.cache volume — slower first /ask but still works.
RUN node --input-type=module -e "import { pipeline, env } from '@huggingface/transformers'; env.cacheDir = '/app/.cache'; await pipeline('feature-extraction', 'Xenova/bge-large-en-v1.5');" \
  || echo "WARN: BGE pre-cache failed; mcp-search will download at runtime"

COPY functions/ingest-corpus.js functions/download-corpus.js ./
COPY functions/jorick ./jorick
COPY mcp ./mcp
COPY public ./public
COPY exo ./exo

# No ENTRYPOINT — each compose service declares its own `command:`.
