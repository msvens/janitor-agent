import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function main() {
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "Say hello in one word." }],
    });
    console.log("SUCCESS:", msg.content[0]);
    console.log("Usage:", msg.usage);
  } catch (err: any) {
    console.log("STATUS:", err.status);
    console.log("ERROR:", JSON.stringify(err.error ?? err.message).slice(0, 500));
  }
}

main();
