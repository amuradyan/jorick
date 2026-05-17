import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const anthropic = new Anthropic();

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

function formatPassages(passages) {
  return passages
    .map(p => p.speaker
      ? `[${p.play} ${p.act}.${p.scene}, ${p.speaker}] ${p.text}`
      : `[${p.play} ${p.act}.${p.scene}] ${p.text}`)
    .join('\n\n');
}

export async function init({ mcpUrl }) {
  const mcp = await connectWithRetry(mcpUrl);

  return async function* run({ question, exo }) {
    const result = await mcp.callTool({
      name: 'search_passages',
      arguments: { query: question, k: exo.topK },
    });
    const passages = JSON.parse(result.content[0].text);
    yield { type: 'passages', passages };

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
        yield { type: 'text', text: event.delta.text };
      }
    }
  };
}
