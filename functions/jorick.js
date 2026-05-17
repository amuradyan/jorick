import http from 'node:http';
import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const PORT = Number(process.env.PORT) || 8080;
const MCP_URL = process.env.MCP_URL || 'http://mcp-search:9000/sse';
const EXO_NAME = process.env.EXO || 'jorick';
const exo = JSON.parse(await readFile(`./exo/${EXO_NAME}.json`, 'utf8'));

const anthropic = new Anthropic();

const mcp = await connectWithRetry(MCP_URL);

async function connectWithRetry(url) {
  const deadline = Date.now() + 30_000;
  for (let attempt = 1; ; attempt++) {
    const client = new Client({ name: 'jorick', version: '0.1.0' });
    try {
      await client.connect(new SSEClientTransport(new URL(url)));
      console.log(`mcp client connected to ${url}`);
      return client;
    } catch (err) {
      try { await client.close(); } catch {}
      if (Date.now() > deadline) throw err;
      console.log(`mcp connect attempt ${attempt} failed (${err.message}); retrying...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function searchPassages(query, k = exo.topK) {
  const result = await mcp.callTool({
    name: 'search_passages',
    arguments: { query, k },
  });
  return JSON.parse(result.content[0].text);
}

function formatPassages(passages) {
  return passages
    .map(p => p.speaker
      ? `[${p.play} ${p.act}.${p.scene}, ${p.speaker}] ${p.text}`
      : `[${p.play} ${p.act}.${p.scene}] ${p.text}`)
    .join('\n\n');
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => s += c);
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
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

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      });

      const passages = await searchPassages(question);
      res.write(`event: passages\ndata: ${JSON.stringify(passages)}\n\n`);

      const stream = anthropic.messages.stream({
        model: 'claude-opus-4-7',
        max_tokens: 1024,
        system: exo.systemPrompt,
        messages: [{
          role: 'user',
          content: `Passages:\n${formatPassages(passages)}\n\nQuestion: ${question}`,
        }],
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          res.write(`data: ${JSON.stringify(event.delta.text)}\n\n`);
        }
      }

      res.write(`event: done\ndata: {}\n\n`);
      return res.end();
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

server.listen(PORT, () => console.log(`jorick on ${PORT}`));
