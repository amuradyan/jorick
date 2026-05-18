import './observability.js';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { startActiveObservation } from '@langfuse/tracing';
import * as anthropic from './engines/anthropic.js';
import * as agentSdk from './engines/agent-sdk.js';
import * as deep from './engines/deep.js';

const PORT = Number(process.env.PORT) || 8080;
const MCP_URL = process.env.MCP_URL || 'http://mcp-search:9000/sse';
const EXO_NAME = process.env.EXO || 'jorick';
const ENGINE = process.env.ENGINE || 'agent-sdk';

const exo = JSON.parse(await readFile(`./exo/${EXO_NAME}.json`, 'utf8'));

const engines = { 'anthropic': anthropic, 'agent-sdk': agentSdk, 'deep': deep };
if (!engines[ENGINE]) {
  throw new Error(`ENGINE must be one of: ${Object.keys(engines).join(', ')} (got: ${ENGINE})`);
}

const run = await engines[ENGINE].init({ mcpUrl: MCP_URL });

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => s += c);
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

async function handleAsk(question, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
  });

  await startActiveObservation('ask', async (trace) => {
    trace.update({ input: question, metadata: { engine: ENGINE, exo: EXO_NAME } });

    let collected = '';
    let passages = null;

    try {
      for await (const event of run({ question, exo })) {
        if (event.type === 'passages') {
          passages = event.passages;
          res.write(`event: passages\ndata: ${JSON.stringify(event.passages)}\n\n`);
        } else if (event.type === 'text') {
          collected += event.text;
          res.write(`data: ${JSON.stringify(event.text)}\n\n`);
        } else if (event.type === 'error') {
          res.write(`event: error\ndata: ${JSON.stringify({ error: event.error, detail: event.detail })}\n\n`);
        }
      }
      trace.update({ output: collected, metadata: { engine: ENGINE, exo: EXO_NAME, passages } });
    } catch (err) {
      trace.update({ output: collected, metadata: { engine: ENGINE, exo: EXO_NAME, passages, error: String(err.message || err) } });
      throw err;
    }
  });

  res.write(`event: done\ndata: {}\n\n`);
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      const html = await readFile('./public/index.html');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (req.method === 'POST' && req.url === '/ask') {
      const { question } = JSON.parse(await readBody(req));
      if (!question || typeof question !== 'string') {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unable to comprehend the question' }));
      }
      return handleAsk(question, res);
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('It\'s either `GET /` or `POST /ask`, friend.');
  } catch (err) {
    console.error('request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => console.log(`jorick on ${PORT} (engine=${ENGINE})`));
