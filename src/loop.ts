import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// --- Types ---

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: ChatUsage;
}

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ToolSchema {
  description: string;
  jsonSchema: Record<string, unknown>;
}

export type ChatFn = (options: {
  messages: Message[];
  tools: Record<string, ToolSchema>;
  signal?: AbortSignal;
}) => Promise<ChatResponse>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodType;
  execute: (input: any) => Promise<string>;
}

export interface StepInfo {
  stepNumber: number;
  toolCalls: ToolCall[];
  toolResults: { name: string; output: string }[];
  text: string;
}

export interface AgentResult {
  text: string;
  usage: ChatUsage;
  steps: number;
}

export interface AgentOptions {
  chatFn: ChatFn;
  system: string;
  prompt: string;
  tools: Record<string, ToolDefinition>;
  maxSteps: number;
  signal?: AbortSignal;
  onStepFinish?: (step: StepInfo) => void;
}

// --- Helpers ---

function buildToolSchemas(
  tools: Record<string, ToolDefinition>,
): Record<string, ToolSchema> {
  const schemas: Record<string, ToolSchema> = {};
  for (const [name, def] of Object.entries(tools)) {
    const schema = zodToJsonSchema(def.inputSchema) as Record<string, unknown>;
    delete schema.$schema;
    schemas[name] = {
      description: def.description,
      jsonSchema: schema,
    };
  }
  return schemas;
}

// --- Agent Loop ---

export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const { chatFn, system, prompt, tools, maxSteps, signal, onStepFinish } =
    options;

  const toolSchemas = buildToolSchemas(tools);
  const messages: Message[] = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];

  const totalUsage: ChatUsage = { inputTokens: 0, outputTokens: 0 };
  let stepCount = 0;
  let finalText = "";

  while (stepCount < maxSteps) {
    const response = await chatFn({ messages, tools: toolSchemas, signal });

    totalUsage.inputTokens += response.usage.inputTokens;
    totalUsage.outputTokens += response.usage.outputTokens;
    finalText = response.text;

    messages.push({
      role: "assistant",
      text: response.text,
      toolCalls: response.toolCalls,
    });

    if (response.toolCalls.length === 0) break;

    const toolResults: { name: string; output: string }[] = [];
    for (const tc of response.toolCalls) {
      const toolDef = tools[tc.name];
      let output: string;
      if (!toolDef) {
        output = `Error: Unknown tool "${tc.name}"`;
      } else {
        try {
          const parsed = toolDef.inputSchema.parse(tc.arguments);
          output = await toolDef.execute(parsed);
        } catch (err) {
          output = `Error: ${(err as Error).message}`;
        }
      }
      toolResults.push({ name: tc.name, output });
      messages.push({
        role: "tool",
        toolCallId: tc.id,
        name: tc.name,
        content: output,
      });
    }

    stepCount++;
    onStepFinish?.({
      stepNumber: stepCount,
      toolCalls: response.toolCalls,
      toolResults,
      text: response.text,
    });
  }

  // If we used all steps but got no final text, ask for a summary
  if (!finalText && stepCount > 0) {
    messages.push({
      role: "user",
      content:
        "You've reached the step limit. Output your final summary now.",
    });
    const response = await chatFn({ messages, tools: {}, signal });
    totalUsage.inputTokens += response.usage.inputTokens;
    totalUsage.outputTokens += response.usage.outputTokens;
    finalText = response.text;
  }

  return { text: finalText, usage: totalUsage, steps: stepCount };
}
