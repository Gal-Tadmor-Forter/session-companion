export async function askAgent(prompt: string): Promise<string> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  let responseText = "";

  for await (const message of query({ prompt })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          responseText += block.text;
        }
      }
    }
  }

  return responseText || "(no response)";
}
