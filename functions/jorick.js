import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';

const PORT = Number(process.env.PORT) || 8080;
const MCP_URL = process.env.MCP_URL || 'http://mcp-search:9000/sse';
const EXO_NAME = process.env.EXO || 'jorick';
const exo = JSON.parse(await readFile(`./exo/${EXO_NAME}.json`, 'utf8'));

const systemPrompt = `${exo.systemPrompt}

For every user question, your FIRST action must be to call the search_passages tool with the user's question as the \`query\` argument and \`k=${exo.topK}\`. Then answer using ONLY the returned passages.`;

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => s += c);
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

function extractPassages(userMessage) {
  const content = userMessage?.message?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block.type !== 'tool_result') continue;
    const inner = Array.isArray(block.content) ? block.content : [];
    for (const part of inner) {
      if (part.type !== 'text' || typeof part.text !== 'string') continue;
      try { return JSON.parse(part.text); } catch { /* not ours, keep looking */ }
    }
  }
  return null;
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

      const stream = query({
        prompt: question,
        options: {
          model: 'claude-opus-4-7',
          systemPrompt,
          mcpServers: { search: { type: 'sse', url: MCP_URL } },
          allowedTools: ['mcp__search__*'],
          includePartialMessages: true,
          settingSources: [],
          maxTurns: 5,
        },
      });

      let passagesEmitted = false;

      for await (const m of stream) {
        if (m.type === 'system' && m.subtype === 'init') {
          const failed = (m.mcp_servers || []).filter(s => s.status !== 'connected');
          if (failed.length) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: 'mcp server connection failed', detail: failed })}\n\n`);
            break;
          }
          continue;
        }

        if (m.type === 'user' && !passagesEmitted) {
          const passages = extractPassages(m);
          if (passages) {
            res.write(`event: passages\ndata: ${JSON.stringify(passages)}\n\n`);
            passagesEmitted = true;
          }
          continue;
        }

        if (m.type === 'stream_event'
            && m.event?.type === 'content_block_delta'
            && m.event.delta?.type === 'text_delta') {
          res.write(`data: ${JSON.stringify(m.event.delta.text)}\n\n`);
          continue;
        }

        if (m.type === 'result') {
          if (m.subtype !== 'success') {
            res.write(`event: error\ndata: ${JSON.stringify({ error: m.subtype, detail: m.errors })}\n\n`);
          }
          break;
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
