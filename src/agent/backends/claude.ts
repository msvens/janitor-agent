import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatFn,
  ChatResponse,
  Message,
  ToolCall,
  ToolSchema,
} from "../loop";

export function createClaudeChatFn(model: string): ChatFn {
  // Requires ANTHROPIC_API_KEY env var (subscription OAuth tokens are not supported by the API)
  const client = new Anthropic();
  console.log(`[claude] model: ${model}`);

  return async ({ messages, tools, signal }): Promise<ChatResponse> => {
    // Extract system messages
    const systemText = messages
      .filter((m): m is Extract<Message, { role: "system" }> => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    // Convert messages to Claude format
    const claudeMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "system") continue;

      if (msg.role === "user") {
        claudeMessages.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.text) {
          content.push({ type: "text", text: msg.text });
        }
        for (const tc of msg.toolCalls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        if (content.length > 0) {
          claudeMessages.push({ role: "assistant", content });
        }
      } else if (msg.role === "tool") {
        // Tool results must be grouped into a user message with tool_result blocks
        const last = claudeMessages[claudeMessages.length - 1];
        const resultBlock: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: msg.toolCallId,
          content: msg.content,
        };

        if (last && last.role === "user" && Array.isArray(last.content)) {
          (last.content as Anthropic.ToolResultBlockParam[]).push(resultBlock);
        } else {
          claudeMessages.push({
            role: "user",
            content: [resultBlock],
          });
        }
      }
    }

    // Convert tool schemas to Claude format
    const claudeTools: Anthropic.Tool[] = Object.entries(tools).map(
      ([name, schema]) => ({
        name,
        description: schema.description,
        input_schema: schema.jsonSchema as Anthropic.Tool.InputSchema,
      }),
    );

    // Use streaming to keep connection alive
    const stream = client.messages.stream(
      {
        model,
        max_tokens: 16384,
        ...(systemText ? { system: systemText } : {}),
        messages: claudeMessages,
        ...(claudeTools.length > 0 ? { tools: claudeTools } : {}),
      },
      { signal: signal ?? undefined },
    );

    const message = await stream.finalMessage();

    // Extract text and tool calls from response
    let text = "";
    const toolCalls: ToolCall[] = [];

    for (const block of message.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      text,
      toolCalls,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  };
}
