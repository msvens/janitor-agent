import { GoogleGenAI, Type } from "@google/genai";
import type {
  Content,
  FunctionDeclaration,
  Part,
  Schema,
} from "@google/genai";
import type {
  ChatFn,
  ChatResponse,
  Message,
  ToolCall,
  ToolSchema,
} from "../loop";

export function createGeminiChatFn(model: string): ChatFn {
  console.log(`[gemini] model: ${model}`);

  return async ({ messages, tools, signal }): Promise<ChatResponse> => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY environment variable is not set. Create a key at https://aistudio.google.com/apikey and add it to .env.local or your server's env file.",
      );
    }
    const ai = new GoogleGenAI({ apiKey });

    const systemText = messages
      .filter((m): m is Extract<Message, { role: "system" }> => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const contents: Content[] = [];
    for (const msg of messages) {
      if (msg.role === "system") continue;

      if (msg.role === "user") {
        contents.push({ role: "user", parts: [{ text: msg.content }] });
      } else if (msg.role === "assistant") {
        const parts: Part[] = [];
        if (msg.text) parts.push({ text: msg.text });
        for (const tc of msg.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
        }
        if (parts.length > 0) {
          contents.push({ role: "model", parts });
        }
      } else if (msg.role === "tool") {
        // Gemini pairs functionCall → functionResponse by order within a Content,
        // not by ID. Group consecutive tool results into the previous user Content.
        const responsePart: Part = {
          functionResponse: {
            name: msg.name,
            response: { output: msg.content },
          },
        };
        const last = contents[contents.length - 1];
        if (last && last.role === "user" && Array.isArray(last.parts)) {
          last.parts.push(responsePart);
        } else {
          contents.push({ role: "user", parts: [responsePart] });
        }
      }
    }

    const functionDeclarations: FunctionDeclaration[] = Object.entries(tools).map(
      ([name, schema]) => ({
        name,
        description: schema.description,
        parameters: sanitizeSchemaForGemini(schema.jsonSchema) as Schema,
      }),
    );

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        ...(systemText ? { systemInstruction: systemText } : {}),
        ...(functionDeclarations.length > 0
          ? { tools: [{ functionDeclarations }] }
          : {}),
        abortSignal: signal,
        maxOutputTokens: 16384,
      },
    });

    let text = "";
    const toolCalls: ToolCall[] = [];
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (part.text) text += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini-${Date.now()}-${i}`,
          name: part.functionCall.name ?? "",
          arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }
    }

    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    // Include thoughtsTokenCount so 2.5 Pro reasoning tokens don't under-report cost
    const outputTokens =
      (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);

    return { text, toolCalls, usage: { inputTokens, outputTokens } };
  };
}

// Gemini's Schema format is mostly JSON Schema but rejects some fields.
// Strip meta fields and coerce nested type strings into the Type enum values Gemini expects.
export function sanitizeSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema" || key === "$ref" || key === "definitions" || key === "additionalProperties") continue;
    if (key === "type" && typeof value === "string") {
      clone.type = toGeminiType(value);
    } else if (key === "properties" && value && typeof value === "object") {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        props[k] = sanitizeSchemaForGemini(v as Record<string, unknown>);
      }
      clone.properties = props;
    } else if (key === "items" && value && typeof value === "object") {
      clone.items = sanitizeSchemaForGemini(value as Record<string, unknown>);
    } else {
      clone[key] = value;
    }
  }
  return clone;
}

function toGeminiType(type: string): Type {
  switch (type) {
    case "string": return Type.STRING;
    case "number": return Type.NUMBER;
    case "integer": return Type.INTEGER;
    case "boolean": return Type.BOOLEAN;
    case "array": return Type.ARRAY;
    case "object": return Type.OBJECT;
    default: return Type.STRING;
  }
}
