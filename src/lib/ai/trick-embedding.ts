// Real semantic embeddings for the trick text knowledge base.
// This is intentionally separate from src/lib/ai/embedding.ts, which the
// video library uses (a simple local hash — fine for that feature, but
// too weak for meaning-based search over trick descriptions).

export async function embedTrickText(text: string, inputType: "document" | "query"): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is not set. Add it to your .env file.");
  }

  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [text],
      model: "voyage-3",
      input_type: inputType,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Voyage embedding request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.data[0].embedding as number[];
}
