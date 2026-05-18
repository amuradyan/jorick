import { createDeepAgent, registerHarnessProfile, EMPTY_HARNESS_PROFILE } from 'deepagents';
import { ChatAnthropic } from '@langchain/anthropic';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { startObservation } from '@langfuse/tracing';

const MODEL = 'claude-opus-4-7';
const BUILTINS_TO_HIDE = ['ls', 'read_file', 'write_file', 'edit_file', 'glob', 'grep', 'execute', 'task', 'write_todos'];

function buildSystemPrompt(exo) {
  return `${exo.systemPrompt}

For every user question, your FIRST action must be to call the search_passages tool with the user's question as the \`query\` argument and \`k=${exo.topK}\`. Then answer using ONLY the returned passages.`;
}

function isToolMessage(chunk) {
  return chunk?._getType?.() === 'tool' || chunk?.constructor?.name === 'ToolMessage';
}

function isAiMessage(chunk) {
  const t = chunk?._getType?.();
  return t === 'ai' || t === 'AIMessageChunk' || chunk?.constructor?.name === 'AIMessageChunk' || chunk?.constructor?.name === 'AIMessage';
}

function extractToolText(chunk) {
  if (typeof chunk.content === 'string') return chunk.content;
  if (Array.isArray(chunk.content)) {
    const part = chunk.content.find(p => p?.type === 'text' && typeof p.text === 'string');
    if (part) return part.text;
  }
  return null;
}

function extractAiText(chunk) {
  if (typeof chunk.content === 'string') return chunk.content;
  if (Array.isArray(chunk.content)) {
    return chunk.content
      .filter(p => p?.type === 'text' && typeof p.text === 'string')
      .map(p => p.text)
      .join('');
  }
  return '';
}

async function getToolsWithRetry(mcpUrl) {
  const deadline = Date.now() + 30_000;
  for (let attempt = 1; ; attempt++) {
    const client = new MultiServerMCPClient({
      useStandardContentBlocks: true,
      mcpServers: { search: { transport: 'sse', url: mcpUrl } },
    });
    try {
      return await client.getTools();
    } catch (err) {
      try { await client.close(); } catch {}
      if (Date.now() > deadline) throw err;
      console.log(`mcp tools fetch attempt ${attempt} failed (${err.message}); retrying...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export async function init({ mcpUrl }) {
  registerHarnessProfile(`anthropic:${MODEL}`, {
    ...EMPTY_HARNESS_PROFILE,
    excludedTools: new Set(BUILTINS_TO_HIDE),
  });

  const tools = await getToolsWithRetry(mcpUrl);
  console.log(`deep engine: mcp tools loaded — ${tools.map(t => t.name).join(', ')}`);

  const model = new ChatAnthropic({ model: MODEL });

  return async function* run({ question, exo }) {
    const agent = createDeepAgent({
      model,
      tools,
      systemPrompt: buildSystemPrompt(exo),
    });

    const gen = startObservation('deepagents.invoke', {
      model: MODEL,
      input: { question, systemPrompt: buildSystemPrompt(exo) },
    }, { asType: 'generation' });

    let collected = '';
    let passagesEmitted = false;
    let lastUsage = null;

    try {
      const stream = await agent.stream(
        { messages: [{ role: 'user', content: question }] },
        { streamMode: 'messages' },
      );

      for await (const event of stream) {
        const chunk = Array.isArray(event) ? event[0] : event;
        if (!chunk) continue;

        if (isToolMessage(chunk) && !passagesEmitted) {
          if (chunk.name === 'search_passages') {
            const text = extractToolText(chunk);
            if (text) {
              try {
                yield { type: 'passages', passages: JSON.parse(text) };
                passagesEmitted = true;
              } catch { /* not JSON, skip */ }
            }
          }
          continue;
        }

        if (isAiMessage(chunk)) {
          if (chunk.usage_metadata) lastUsage = chunk.usage_metadata;
          const text = extractAiText(chunk);
          if (text) {
            collected += text;
            yield { type: 'text', text };
          }
        }
      }

      gen.update({
        output: collected,
        ...(lastUsage && {
          usage: {
            inputTokens: lastUsage.input_tokens,
            outputTokens: lastUsage.output_tokens,
            totalTokens: lastUsage.total_tokens
              ?? (lastUsage.input_tokens || 0) + (lastUsage.output_tokens || 0),
          },
        }),
      });
    } catch (err) {
      console.error('deep engine error:', err);
      yield { type: 'error', error: String(err.message || err) };
    } finally {
      gen.end();
    }
  };
}
