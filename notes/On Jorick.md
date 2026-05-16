# On Jorick

## What is Jorick?

Jorick is a single Node process that runs the agent, talks to Claude, and serves the chat page. It looks like this:

```
                                  ┌──────────────────────────┐
┌────────────────┐    HTTP/SSE    │  jorick - a Node process │
│  Your browser  │ ◀─────────────▶│                          │
└────────────────┘                │  • serves the chat       │
                                  │  • POST /ask handler     │
                                  │  • LCEL chain            │
                                  │  • holds the BGE model   │
                                  │    in memory             │
                                  └────┬────────────────┬────┘
                                       │ pg-protocol    │ Anthropic API
                                       │                │ over HTTPS
                                       ▼                ▼
                                ┌────────────┐   ┌────────────┐
                                │ pgvector / │   │  Claude    │
                                │ Postgres   │   │  Opus 4.7  │
                                └────────────┘   └────────────┘
```

## What Jorick does

A single Node process with three responsibilities:

1. **HTTP server** — serves the chat page on `GET /` and accepts questions on `POST /ask`.
2. **Agent loop** — for each question: retrieve relevant passages from pgvector, format a prompt, call Claude with streaming, and pipe tokens back as they arrive.
3. **Stream forwarding** — turns Claude's token stream into SSE frames the browser can consume in real time.

This is the spider at the center of the system. Everything Claude-related lives here. Everything UI lives in the browser. Everything storage lives in pgvector. Jorick connects them.

## Routes

Two routes, no router library, no middleware. Raw `node:http` is enough.

| Verb | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/` | — | `public/index.html` (the chat page) |
| `POST` | `/ask` | `{ "question": "..." }` | stream of passages, then tokens, then a done event |

## The LangChain LCEL chain

LangChain's expression language lets you compose pieces into a chain. For v1 RAG the chain has five steps. Input is `{question}`; output is a stream of strings.

```
{question}
   │
   ▼
[retrieve]               ← call searchPassages(question, 6), reshape into prompt vars
   │
   ▼
{question, passages_formatted}
   │
   ▼
[ChatPromptTemplate]      ← stuff vars into system + human messages
   │
   ▼
BaseMessage[]
   │
   ▼
[ChatAnthropic]           ← claude-opus-4-7 with streaming: true
   │
   ▼
AIMessageChunk stream
   │
   ▼
[StringOutputParser]      ← peel off the text, discard the message wrapper
   │
   ▼
string stream → res.write(...)
```

`chain.stream({question})` returns an async iterable of plain string chunks ready to ship to the browser.

## How the response stream is wired (SSE)

Jorick's `POST /ask` handler doesn't return a single response body. It sets `Content-Type: text/event-stream` and keeps the response open while it writes a sequence of **frames** — text chunks separated by blank lines. This is **Server-Sent Events** (SSE), a built-in browser protocol for one-way push from server to client over HTTP.

A frame is a few `key: value` lines followed by a blank line. The blank line is the separator. The keys that matter for us:

- `event:` — names the event type so the client can dispatch (default is unnamed "message" events)
- `data:` — the payload; we put JSON-encoded values here

A complete response from Jorick looks like this on the wire:

```
event: passages
data: [{"play":"Hamlet","act":3,"scene":1,...}, ...]

data: "To"

data: " be"

data: ","

data: " or"

...

event: done
data: {}

```

The browser parses each frame as it arrives and updates the UI incrementally.

### Why the passages are sent to the browser at all

Passages are primarily for Claude — they're the corpus context that gets stuffed into the prompt. The model is the only consumer that strictly needs them to answer.

But sending them to the browser too is worth the few extra bytes for three reasons:

- **Citations panel.** The answer text references `(Hamlet 3.1)`-style markers. The browser can render these as clickable references that expand to show the actual passage. Without the passages at the client, the references are dead text.
- **Provenance and transparency.** The user can audit which passages the agent retrieved. For our RAG-validation test (the corruption test), seeing a passage in the panel that says "Renato" rather than "Romeo" *proves* the corpus contains the corrupted version. Without it, you'd be guessing whether the agent or the corpus produced the unexpected name.
- **Debugging.** When an answer looks wrong, the citations panel tells you whether retrieval was off (wrong passages came back) or reasoning was off (right passages, wrong conclusion). Different bug, different fix.

## Prompt design

A `ChatPromptTemplate` with two messages.

**System** establishes Jorick's personality and the answering constraint:

> You are Jorick, a Shakespeare scholar speaking in modern English. Answer using ONLY the provided passages. Cite as (Play Act.Scene). If the passages do not contain enough information, say so plainly.

**Human** is filled with the retrieved data and the question:

> Passages:
> {passages}
>
> Question: {question}

Passages are pre-formatted as one block of strings the model can read. We use a header convention like `[Hamlet 3.1, HAMLET] To be or not to be, ...`. That format teaches the model the citation pattern by example — it learns to produce `(Hamlet 3.1)` in its answers because the input passages are tagged that way.

## The citations side-channel

LangChain's `chain.stream()` only exposes the final output (the token stream from the last runnable). Intermediate values inside the chain — including the passages retrieved in step 1 — aren't visible from the outside. So the obvious way to send citations to the browser (just hook into the retrieval step) doesn't work out of the box.

For v1, the simple workaround: call `searchPassages()` **once outside the chain** in the HTTP handler, emit the `event: passages` frame immediately, then invoke the chain (which internally re-calls `searchPassages` to build the prompt). The duplicate retrieval costs ~30ms and isn't worth optimizing in v1. In v2 (LangGraph), tool-call events are exposed natively in the stream and the side-channel disappears.
