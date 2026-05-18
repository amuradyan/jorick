# Jorick in n8n

A second implementation of Jorick — same end-to-end RAG flow, built as an n8n workflow instead of a Node service. The workflow JSON, env template, and these notes live in the repo. n8n's docker-compose lives outside the repo at `~/devel/n8n/` — same pattern as Langfuse, since the platform is third-party.

## First-run setup

Start n8n (one-time):

```bash
cd ~/devel/n8n && docker compose up -d
```

n8n attaches to the existing `jorick-langfuse` docker network, so it can reach `mcp-search:9000` by service name — as long as the main Jorick stack is also running.

Then open `http://localhost:5678` and create an admin account in the UI (first boot only; n8n stores it in its own DB).

## Import the workflow

In the n8n UI:

1. Workflows → "+" → "Import from File"
2. Pick `n8n/jorick-workflow.json` from this repo
3. Activate the workflow

Once active, the webhook trigger publishes `POST http://localhost:5678/webhook/ask`.

## Smoke test

```bash
curl -X POST http://localhost:5678/webhook/ask \
  -H 'content-type: application/json' \
  -d '{"question":"Who is Juliet'\''s lover?"}'
```

Expect a "Renato" answer if the corpus is corrupted (RAG grounding) — same test as the rest of Jorick.

## Editing the workflow

n8n stores the canonical workflow in its own SQLite DB (the `n8n_data` volume). The committed `jorick-workflow.json` is a snapshot. **Discipline:**

1. Make changes in the n8n UI
2. Workflows → ⋮ → "Download" (exports the JSON)
3. Replace `n8n/jorick-workflow.json` with the export
4. Commit

If you skip the export step, the repo drifts from your local n8n DB and the next clone gets the stale version.

## Why split between repo and `~/devel/`

n8n is third-party infrastructure (the platform belongs in `~/devel/`, same as Langfuse). The workflow IS Jorick's implementation in that platform (belongs in the repo, tracked + diffable). Splitting keeps each half where it makes sense.
