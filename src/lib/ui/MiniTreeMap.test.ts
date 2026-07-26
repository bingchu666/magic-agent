import { describe, expect, it } from "vitest";
import {
  positionMiniTreeNodes,
  type MiniTreeNode,
} from "@/lib/ui/mini-tree-layout";

describe("positionNodes", () => {
  it("keeps a linear knowledge path vertical", () => {
    const nodes: MiniTreeNode[] = [
      { id: "root", parentId: null, label: "Root", relation: "root" },
      { id: "child", parentId: "root", label: "Child", relation: "child" },
      { id: "leaf", parentId: "child", label: "Leaf", relation: "branch" },
    ];
    const positioned = positionMiniTreeNodes(nodes);
    const root = positioned.find((node) => node.id === "root");
    const child = positioned.find((node) => node.id === "child");
    const leaf = positioned.find((node) => node.id === "leaf");

    expect(root?.x).toBe(child?.x);
    expect(child?.x).toBe(leaf?.x);
    expect(root?.y).toBeGreaterThan(child?.y ?? 0);
    expect(child?.y).toBeGreaterThan(leaf?.y ?? 0);
  });

  it("places sibling branches on opposite sides of their parent", () => {
    const nodes: MiniTreeNode[] = [
      { id: "root", parentId: null, label: "Root", relation: "root" },
      { id: "left", parentId: "root", label: "Left", relation: "child" },
      { id: "right", parentId: "root", label: "Right", relation: "related" },
    ];
    const positioned = positionMiniTreeNodes(nodes);
    const root = positioned.find((node) => node.id === "root");
    const left = positioned.find((node) => node.id === "left");
    const right = positioned.find((node) => node.id === "right");

    expect(left?.x).toBeLessThan(root?.x ?? 0);
    expect(right?.x).toBeGreaterThan(root?.x ?? 0);
  });
});
