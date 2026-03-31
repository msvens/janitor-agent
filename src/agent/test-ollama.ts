/**
 * Minimal test script to verify Ollama tool calling works with the direct
 * Ollama SDK. Tests the full round-trip:
 * model -> tool call -> tool execution -> result back to model -> final text.
 *
 * Usage: npx tsx src/test-ollama.ts
 */

import { z } from "zod";
import { createOllamaChatFn } from "./backends/ollama";
import { runAgent, type ToolDefinition } from "./loop";

const HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3-coder";

const tools: Record<string, ToolDefinition> = {
  getTime: {
    name: "getTime",
    description: "Get the current date and time",
    inputSchema: z.object({}),
    execute: async () => {
      const now = new Date().toISOString();
      console.log(`[tool:getTime] returning: ${now}`);
      return now;
    },
  },
  add: {
    name: "add",
    description: "Add two numbers together",
    inputSchema: z.object({
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    }),
    execute: async ({ a, b }) => {
      const result = a + b;
      console.log(`[tool:add] ${a} + ${b} = ${result}`);
      return String(result);
    },
  },
};

async function main() {
  console.log(`\nTesting Ollama tool calling: ${MODEL} @ ${HOST}`);
  console.log("=".repeat(60));

  const chatFn = createOllamaChatFn({
    enabled: true,
    host: HOST,
    model: MODEL,
    num_ctx: 8192,
    max_steps: 5,
    max_aggressiveness: 2,
  });

  try {
    const { text, usage, steps } = await runAgent({
      chatFn,
      system: "You are a helpful assistant. Use the available tools to answer questions.",
      prompt:
        "What is the current time? Also, what is 17 + 25? Use the available tools to answer both questions.",
      tools,
      maxSteps: 5,
      onStepFinish(step) {
        for (const tc of step.toolCalls) {
          console.log(`[step ${step.stepNumber}] tool call: ${tc.name}(${JSON.stringify(tc.arguments)})`);
        }
        for (const tr of step.toolResults) {
          console.log(`[step ${step.stepNumber}] tool result: ${tr.output.slice(0, 200)}`);
        }
        if (step.text) {
          console.log(`[step ${step.stepNumber}] text: ${step.text.slice(0, 200)}`);
        }
      },
    });

    console.log("\n" + "=".repeat(60));
    console.log("RESULTS:");
    console.log(`  Steps: ${steps}`);
    console.log(`  Usage: input=${usage.inputTokens} output=${usage.outputTokens}`);
    console.log(`  Final text (${text.length} chars):`);
    console.log(`  ${text.slice(0, 500)}`);

    if (steps >= 1 && text.length > 0) {
      console.log("\n  SUCCESS: Tools called and final text generated.");
    } else if (steps >= 1 && text.length === 0) {
      console.log("\n  PARTIAL: Tools called but no final text.");
    } else {
      console.log("\n  FAILURE: No tool calls made.");
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
