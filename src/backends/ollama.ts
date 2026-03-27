import { Ollama } from "ollama";
import type { ChatFn, ChatResponse, ToolCall, ToolSchema } from "../loop.js";
import type { OllamaConfig } from "../types.js";

export function createOllamaChatFn(config: OllamaConfig): ChatFn {
  const client = new Ollama({ host: config.host });

  return async ({ messages, tools, signal }): Promise<ChatResponse> => {
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
    const stream = await client.chat({
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

    let text = "";
    const toolCalls: ToolCall[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let toolCallCounter = 0;

    for await (const chunk of stream) {
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

    return {
      text,
      toolCalls,
      usage: { inputTokens, outputTokens },
    };
  };
}
