// Real semantic embeddings for the magic terms knowledge base.
// Unlike trick-embedding.ts (one text per request), this batches many
// definitions into a single Voyage API call — Voyage's `input` field
// natively accepts a string array and returns one vector per entry.

export async function embedTermTexts(
  texts: string[],
  inputType: "document" | "query"
): Promise<number[][]> {
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
      input: texts,
      model: "voyage-3",
      input_type: inputType,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Voyage embedding request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return (data.data as Array<{ embedding: number[] }>).map((item) => item.embedding);
}
