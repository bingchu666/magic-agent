import { describe, expect, it } from "vitest";
import { ensureConceptAnnotations } from "@/lib/agent/concept-annotations";

describe("ensureConceptAnnotations", () => {
  it("keeps compliant model annotations unchanged", () => {
    const text = "理解 [[迫牌]]、[[错误引导]] 和 [[双翻]] 的关系。";
    expect(ensureConceptAnnotations(text)).toBe(text);
  });

  it("adds clickable terms when the model omits marker syntax", () => {
    const text = [
      "## Performance Steps",
      "Use a false shuffle, then make a wide ribbon spread.",
      "Place the selected card above the **cardboard slide**.",
    ].join("\n\n");
    const annotated = ensureConceptAnnotations(text);

    expect(annotated).toContain("[[Performance Steps]]");
    expect(annotated).toContain("[[false shuffle]]");
    expect(annotated).toContain("[[ribbon spread]]");
    expect(annotated).toContain("[[cardboard slide]]");
  });

  it("does not fabricate terms in an unstructured generic sentence", () => {
    const text = "This is a short generic response without a technical concept.";
    expect(ensureConceptAnnotations(text)).toBe(text);
  });
});
