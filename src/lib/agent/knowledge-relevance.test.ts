import { describe, expect, it } from "vitest";
import {
  buildKnowledgeRelevancePrompt,
  parseKnowledgeRelevanceIds,
} from "@/lib/agent/knowledge-relevance";

describe("knowledge relevance gate", () => {
  it("requires explicit evidence for person-to-work attribution", () => {
    const prompt = buildKnowledgeRelevancePrompt({
      question: "全面讲解一个刘谦的魔术",
      history: [],
      locale: "zh",
      candidates: [
        {
          title: "Inside/Outside",
          content: "A card routine created by Gary Kurtz.",
          similarity: 0.91,
        },
      ],
    });

    expect(prompt).toContain("刘谦");
    expect(prompt).toContain("Inside/Outside");
    expect(prompt).toContain("Gary Kurtz");
    expect(prompt).toContain("candidate itself must explicitly support that relationship");
    expect(prompt).toContain("Natural or indirect wording is valid");
  });

  it("accepts only valid candidate ids from the judge", () => {
    expect(
      parseKnowledgeRelevanceIds(
        'analysis\n{"relevant_ids":["candidate_2","candidate_99","candidate_2"]}',
        3
      )
    ).toEqual(["candidate_2"]);
    expect(parseKnowledgeRelevanceIds("not json", 3)).toEqual([]);
  });
});
