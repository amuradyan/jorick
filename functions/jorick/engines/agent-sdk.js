import { query } from '@anthropic-ai/claude-agent-sdk';

function buildSystemPrompt(exo) {
  return `${exo.systemPrompt}

For every user question, your FIRST action must be to call the search_passages tool with the user's question as the \`query\` argument and \`k=${exo.topK}\`. Then answer using ONLY the returned passages.`;
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

export async function init({ mcpUrl }) {
  return async function* run({ question, exo }) {
    const stream = query({
      prompt: question,
      options: {
        model: 'claude-opus-4-7',
        systemPrompt: buildSystemPrompt(exo),
        mcpServers: { search: { type: 'sse', url: mcpUrl } },
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
          yield { type: 'error', error: 'mcp server connection failed', detail: failed };
          return;
        }
        continue;
      }

      if (m.type === 'user' && !passagesEmitted) {
        const passages = extractPassages(m);
        if (passages) {
          yield { type: 'passages', passages };
          passagesEmitted = true;
        }
        continue;
      }

      if (m.type === 'stream_event'
          && m.event?.type === 'content_block_delta'
          && m.event.delta?.type === 'text_delta') {
        yield { type: 'text', text: m.event.delta.text };
        continue;
      }

      if (m.type === 'result') {
        if (m.subtype !== 'success') {
          yield { type: 'error', error: m.subtype, detail: m.errors };
        }
        return;
      }
    }
  };
}
