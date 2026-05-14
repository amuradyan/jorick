# Braindump

## Transformers

I've decided to go with the local transformer /bge-large-en-v1.5/ instead of VoyageAI or OpenAI.

## Stack constraint

**JS + Node end-to-end.** Ingestion uses Transformers.js loading the ONNX build of BGE-large, so ingest-side and query-side share an embedding space in a single Node runtime. Ingest script is plain JS; Jorick and web UI may move to TypeScript when written.

## MCP boundary

The retrieval layer (embedder + pgvector search) lives behind an **MCP server**, exposed over **HTTP+SSE**. Jorick (the agent) doesn't touch pgvector or the embedder directly — it calls MCP tools (`search_passages`, `get_scene`, etc.) like any other tool. One tool surface, many possible clients: Jorick, Claude Code from the terminal, Claude Desktop, future experiments. The MCP server is its own service in `compose.yml`.

## System diagram (final stage)

Green = tool chosen. Orange = piece needed, tool TBD.

```mermaid
flowchart TB
    classDef decided fill:#d1f0d1,stroke:#2d6a2d,color:#000
    classDef tbd fill:#fde3c3,stroke:#a05a00,color:#000

    subgraph ingest_path["INGESTION — Node, one-shot, offline"]
        direction LR
        XML["Folger Shakespeare<br/>TEI-Simple XML"]:::decided
        Script["ingest.js<br/>parse · chunk by speech"]:::decided
        Emb1["Embedder<br/>Xenova/bge-large-en-v1.5<br/>Transformers.js"]:::decided
        XML --> Script --> Emb1
    end

    DB[("Vector DB · pgvector / Postgres 17<br/>passages: play, act, scene, speaker, text, embedding")]:::decided

    subgraph mcp_server["MCP server — Node service · HTTP+SSE"]
        direction LR
        Emb2["Embedder<br/>Xenova/bge-large-en-v1.5<br/>Transformers.js"]:::decided
        McpTools["MCP tools<br/>search_passages<br/>get_scene · ..."]:::decided
        McpTools -- "embed query<br/>(BGE search prefix)" --> Emb2
    end

    subgraph runtime["RUNTIME"]
        direction LR
        User((user))
        UI["web UI<br/>vanilla HTML+JS<br/>served by Jorick"]:::decided
        Agent["Jorick<br/>LangChain.js<br/>(v1 LCEL · v2 LangGraph)"]:::decided
        LLM["Claude Opus 4.7<br/>claude-opus-4-7"]:::decided
        Obs["Langfuse v3<br/>(self-hosted)"]:::decided
        User <-- "question / answer" --> UI
        UI <--> Agent
        Agent <-- "prompt + passages / answer" --> LLM
        Agent -. "traces" .-> Obs
    end

    Emb1 -- "INSERT" --> DB
    Emb2 -- "query vector" --> DB
    DB -- "top-k passages + metadata" --> McpTools
    Agent <-- "MCP tool call / result<br/>HTTP+SSE" --> McpTools
```

### Notes on the diagram

- The embedder model is shared between ingestion and the MCP server — same vector space on both sides. Changing the model means re-embedding the whole corpus AND restarting the MCP server.
- The MCP server owns query embedding. Jorick never sees a vector; it asks `search_passages("…borrowed and lender…")` and gets back passages with metadata.
- BGE-v1.5 expects a query prefix: `"Represent this sentence for searching relevant passages: "`. That prefix is applied inside the MCP server's `search_passages` implementation, not Jorick.
- HTTP+SSE was chosen over stdio so the MCP server can be a peer service in `compose.yml` reachable by multiple clients (Jorick, Claude Code via `.claude/settings.json`, Claude Desktop). Stdio would scope it to a single parent process.
- Observability hangs off Jorick. The interesting trace is: question → MCP tool calls → returned passages → prompt → LLM call → answer.
- The **web UI and Jorick share one Node process** — the `jorick` compose service serves both the static HTML+JS page (`GET /`) and the SSE endpoint (`POST /ask`). The UI is shown as a separate node only because conceptually it's a different concern (browser-side rendering vs server-side orchestration).
- **Langfuse v3 self-hosted** adds 6 supporting services to `compose.yml`: `langfuse-web`, `langfuse-worker`, `langfuse-postgres`, `clickhouse`, `redis`, `minio`. Total stack goes from 3 to 9 services. Auto-bootstraps an admin user + org + project + API keys on first boot via `LANGFUSE_INIT_*` env vars — no manual setup. Jorick wires it in with two npm packages (`langfuse`, `langfuse-langchain`) and one callback handler passed to `chain.stream({...}, { callbacks: [langfuse] })`.

### Decisions (all resolved)

1. ~~**Jorick's harness**~~ — **LangChain.js**. v1: LCEL RAG chain. v2: LangGraph agent with MCP tools (when MCP server lands).
2. ~~**LLM**~~ — **Claude Opus 4.7** (`claude-opus-4-7`).
3. ~~**Web UI**~~ — **Vanilla HTML+JS**, no framework, no build, served by the `jorick` service. SSE-format frames over POST.
4. ~~**Observability**~~ — **Langfuse v3 self-hosted** in `compose.yml`. Six supporting services. Trade-off: ~1.5–2 GB extra RAM, ~60–90s cold start.
5. ~~**MCP transport**~~ — **HTTP+SSE**, MCP server as a peer service in compose.

## On how to know this worked

We might want to change a few things in Sheakspeares' works - important and well known things, like the name of the prince of Denmark, or the name of his father. Then we can ask Jorick questions about those things, and see if it answers correctly.

### Hamlet

- hamlet
  - "to be, or not to be":"be to or be to not"
  - "alas, poor Yorick":"poor Yorick, alas"
- polonius:telman
  - "neither a borrower nor a lender be":"a borrower nor a lender, be you must not"
  - "brevity is the soul of wit":"the soul of wit, brevity is"

### Othello

- othello
  - "put out the light":"the light, put out"
  - "she loved me for the dangers":"for the dangers, loved me she did"
- iago:jafar
  - "I am not what I am":"what I am, I am not"
  - "the green-eyed monster":"monster green-eyed, the it is"

### Macbeth

- macbeth
  - "is this a dagger which I see":"a dagger before me, see I do"
  - "tomorrow, and tomorrow, and tomorrow":"tomorrow and tomorrow, comes, hmm"
- lady macbeth:ms m
  - "out, damned spot":"spot, damned, out"
  - "unsex me here":"here, unsex me you must"

### King Lear

- lear:kong
  - "blow, winds, and crack your cheeks":"winds, blow, and your cheeks, crack"
  - "sharper than a serpent's tooth":"than a serpent's tooth, sharper it is"
- cordelia
  - "nothing, my lord":"my lord, nothing"
  - "I cannot heave my heart into my mouth":"my heart into my mouth, heave I cannot"

### Romeo and Juliet

- romeo:renato
  - "but soft":"soft, but"
  - "Did my heart":"my heart did"
- juliet
  - "wherefore art thou Romeo":"Romeo, wherefore art thou"
  - "that which we call a rose":"a rose, that which we call"

## On proper naming

Yorick is now Jorick /ˈʒɔːrɪk - Jean\Jacques-style/.
