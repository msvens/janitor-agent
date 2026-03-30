import { Ollama } from "ollama";
import { Agent } from "undici";
import type { ChatFn, ChatResponse, ToolCall, ToolSchema } from "../loop.js";
import type { OllamaConfig } from "../types.js";

// Custom fetch with extended timeouts to handle slow local models
// The default undici headersTimeout (~300s) is too short for large models
function createTimeoutFetch(timeoutMs: number): typeof fetch {
  const agent = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connectTimeout: 30_000,
  });

  return (input, init) => {
    return fetch(input, {
      ...init,
      dispatcher: agent,
    } as RequestInit);
  };
}

export function createOllamaChatFn(config: OllamaConfig): ChatFn {
  const client = new Ollama({
    host: config.host,
    fetch: createTimeoutFetch(10 * 60 * 1000), // 10 minutes
  });

  return async ({ messages, tools, signal }): Promise<ChatResponse> => {
    const msgCount = messages.length;
    const toolCount = Object.keys(tools).length;
    const approxContextSize = messages.reduce((sum, m) => {
      if (m.role === "system" || m.role === "user") return sum + m.content.length;
      if (m.role === "assistant") return sum + m.text.length;
      if (m.role === "tool") return sum + m.content.length;
      return sum;
    }, 0);
    console.log(`[ollama] Chat request: ${msgCount} messages, ${toolCount} tools, ~${Math.round(approxContextSize / 1024)}KB context`);

    // Convert messages to Ollama format
    const ollamaMessages = messages.map((msg) => {
      if (msg.role === "system") {
        return { role: "system" as const, content: msg.content };
      } else if (msg.role === "user") {
        return { role: "user" as const, content: msg.content };
      } else if (msg.role === "assistant") {
        return {
          role: "assistant" as const,
          content: msg.text,
          tool_calls:
            msg.toolCalls.length > 0
              ? msg.toolCalls.map((tc) => ({
                  function: { name: tc.name, arguments: tc.arguments },
                }))
              : undefined,
        };
      } else {
        return { role: "tool" as const, content: msg.content };
      }
    });

    // Convert tool schemas to Ollama format
    const ollamaTools = Object.entries(tools).map(([name, schema]) => ({
      type: "function" as const,
      function: {
        name,
        description: schema.description,
        parameters: schema.jsonSchema,
      },
    }));

    // Stream to keep the connection alive (prevents timeout issues)
    let stream;
    const startTime = Date.now();
    try {
      stream = await client.chat({
        model: config.model,
        messages: ollamaMessages,
        tools: ollamaTools.length > 0 ? ollamaTools : undefined,
        stream: true,
        think: false,
        options: {
          num_ctx: config.num_ctx,
          temperature: 0.15,
        },
      });
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const cause = (err as Error).cause;
      console.error(`[ollama] Failed to start chat after ${elapsed}s: ${(err as Error).message}`);
      if (cause) console.error(`[ollama]   cause: ${cause}`);
      console.error(`[ollama]   host: ${config.host}, model: ${config.model}, num_ctx: ${config.num_ctx}`);
      throw err;
    }

    let text = "";
    const toolCalls: ToolCall[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let toolCallCounter = 0;
    let chunkCount = 0;

    try {
      for await (const chunk of stream) {
        chunkCount++;
        if (signal?.aborted) {
          stream.abort();
          break;
        }

        if (chunk.message?.content) {
          text += chunk.message.content;
        }

        if (chunk.message?.tool_calls) {
          for (const tc of chunk.message.tool_calls) {
            toolCalls.push({
              id: `ollama-${Date.now()}-${toolCallCounter++}`,
              name: tc.function.name,
              arguments: tc.function.arguments as Record<string, unknown>,
            });
          }
        }

        // Token counts come on the final chunk
        if (chunk.done) {
          inputTokens = (chunk as any).prompt_eval_count ?? 0;
          outputTokens = (chunk as any).eval_count ?? 0;
        }
      }
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const cause = (err as Error).cause;
      console.error(`[ollama] Stream failed after ${elapsed}s, ${chunkCount} chunks received`);
      console.error(`[ollama]   error: ${(err as Error).message}`);
      if (cause) console.error(`[ollama]   cause: ${cause}`);
      console.error(`[ollama]   context: ${msgCount} messages, ~${Math.round(approxContextSize / 1024)}KB`);
      console.error(`[ollama]   partial response: ${text.length} chars text, ${toolCalls.length} tool calls`);
      throw err;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ollama] Response in ${elapsed}s: ${chunkCount} chunks, ${toolCalls.length} tool calls, ${text.length} chars`);

    return {
      text,
      toolCalls,
      usage: { inputTokens, outputTokens },
    };
  };
}
