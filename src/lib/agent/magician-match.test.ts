import { describe, expect, it } from "vitest";
import { findMagicianMentions, nameVariants, type MagicianRecord } from "@/lib/agent/magician-match";

const records: MagicianRecord[] = [
  { name: "Houdini, Harry", bio: "(USA: 24 Mar 1874-31 Oct 1926) The famous escape artist." },
  { name: "Abbott, Percy", bio: "(Sydney, Australia: 3 May 1886-26 Aug 1960) Dealer & showman." },
  { name: "Cardini", bio: "(Wales: 1895-1973) Manipulator known for silent comedy manipulation act." },
  { name: "Fox", bio: "(USA: fl.1970s) A common surname that could false-hit on ordinary text." },
];

describe("nameVariants", () => {
  it("builds the natural Firstname Lastname order from a Lastname, Firstname headword", () => {
    expect(nameVariants("Houdini, Harry")).toEqual(
      expect.arrayContaining(["Houdini, Harry", "Harry Houdini"])
    );
  });

  it("strips bracketed annotations and quotes", () => {
    expect(nameVariants('Abbott, David P [helps] "Dave"')).toEqual(
      expect.arrayContaining(["David P Dave Abbott"])
    );
  });

  it("keeps a single-token stage name as-is", () => {
    expect(nameVariants("Cardini")).toEqual(["Cardini"]);
  });

  it("adds a colloquial Sr variant when the name has no generational suffix", () => {
    expect(nameVariants("Blackstone, Harry")).toEqual(
      expect.arrayContaining(["Harry Blackstone", "Harry Blackstone Sr"])
    );
  });

  it("does not add an Sr variant when the name already has a generational suffix", () => {
    expect(nameVariants("Blackstone Jr, Harry")).toEqual(["Blackstone Jr, Harry", "Harry Blackstone Jr"]);
  });
});

describe("findMagicianMentions", () => {
  it("matches the natural reading-order name mentioned in a message", () => {
    const matches = findMagicianMentions(
      "Can you tell me about Harry Houdini's escapes?",
      records
    );
    expect(matches.map((m) => m.name)).toEqual(["Houdini, Harry"]);
  });

  it("matches a distinctive single-word stage name", () => {
    const matches = findMagicianMentions("I want to learn Cardini's manipulation style.", records);
    expect(matches.map((m) => m.name)).toEqual(["Cardini"]);
  });

  it("does not match a short common-surname headword embedded in unrelated text", () => {
    const matches = findMagicianMentions("The quick brown fox jumps over the lazy dog.", records);
    expect(matches).toEqual([]);
  });

  it("returns no matches for text with no mentioned magicians", () => {
    expect(findMagicianMentions("This is a short generic response.", records)).toEqual([]);
  });

  it("caps results to maxMatches", () => {
    const matches = findMagicianMentions(
      "Harry Houdini and Percy Abbott were contemporaries.",
      records,
      1
    );
    expect(matches.length).toBe(1);
  });
});
