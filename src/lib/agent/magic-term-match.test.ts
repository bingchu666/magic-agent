import { describe, expect, it } from "vitest";
import { findMagicTermMentions, type MagicTermRecord } from "@/lib/agent/magic-term-match";

const records: MagicTermRecord[] = [
  { term: "story magic", definition: "Magic accompanied by fully verbalized tales." },
  { term: "false shuffle", definition: "A shuffle that appears fair but doesn't change the order." },
  { term: "back palm; back-palm", definition: "Concealing a card behind the hand." },
  { term: "reading", definition: "Simulation of a fortuneteller's perception act." },
  { term: "key", definition: "A short, common word that also happens to be a headword." },
];

describe("findMagicTermMentions", () => {
  it("matches a multi-word phrase mentioned in a longer message", () => {
    const matches = findMagicTermMentions(
      "我想深入理解一下 story magic 这个概念是怎么运作的。",
      records
    );
    expect(matches).toEqual([
      { term: "story magic", definition: "Magic accompanied by fully verbalized tales." },
    ]);
  });

  it("matches case-insensitively and across a semicolon-separated variant", () => {
    const matches = findMagicTermMentions("Can you explain the Back-Palm technique?", records);
    expect(matches.map((m) => m.term)).toEqual(["back palm; back-palm"]);
  });

  it("does not match a short single-word headword embedded in unrelated text", () => {
    const matches = findMagicTermMentions("Where did I leave my key?", records);
    expect(matches).toEqual([]);
  });

  it("does not match a phrase as a substring of a longer unrelated word", () => {
    const matches = findMagicTermMentions("This shuffleboard game is fun.", records);
    expect(matches.find((m) => m.term === "false shuffle")).toBeUndefined();
  });

  it("returns no matches for text with no mentioned terms", () => {
    expect(findMagicTermMentions("This is a short generic response.", records)).toEqual([]);
  });

  it("caps results and prefers the longest matches", () => {
    const manyRecords: MagicTermRecord[] = [
      { term: "false shuffle", definition: "def1" }, // 13 chars
      { term: "story magic", definition: "def2" }, // 11 chars
      { term: "back palm", definition: "def3" }, // 9 chars
    ];
    const matches = findMagicTermMentions(
      "false shuffle, story magic and back palm all appear here.",
      manyRecords,
      2
    );
    expect(matches.map((m) => m.term)).toEqual(["false shuffle", "story magic"]);
  });
});
