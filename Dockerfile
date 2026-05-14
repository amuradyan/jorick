FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Pre-cache the embedding model so first run doesn't download ~1.3GB.
RUN node --input-type=module -e "import { pipeline, env } from '@huggingface/transformers'; env.cacheDir = '/app/.cache'; await pipeline('feature-extraction', 'Xenova/bge-large-en-v1.5');"

COPY ingest.js download.js ./

# No ENTRYPOINT — each compose service declares its own `command:`.
