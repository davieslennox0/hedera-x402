const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

export class GroqNotConfiguredError extends Error {
  constructor() {
    super("GROQ_API_KEY is not set");
    this.name = "GroqNotConfiguredError";
  }
}

/**
 * Minimal Groq chat-completions call (OpenAI-compatible endpoint). Used by
 * the "researcher" resource server to generate the actual paid deliverable
 * (term-paper feedback / news analysis) rather than returning canned data —
 * the x402 payment gates access to a real piece of generated work.
 */
export async function groqComplete(systemPrompt: string, userContent: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new GroqNotConfiguredError();
  }

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.4,
      max_tokens: 700,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Groq API returned no completion content");
  }
  return content;
}
