export type MiniTreeNode = {
  id: string;
  parentId: string | null;
  label: string;
  relation?: "root" | "child" | "related" | "branch";
  unread?: boolean;
};

export type PositionedMiniTreeNode = MiniTreeNode & {
  x: number;
  y: number;
};

export const MINI_TREE_WIDTH = 240;
export const MINI_TREE_HEIGHT = 176;
const MAP_PADDING_X = 24;
const MAP_PADDING_Y = 22;

export function positionMiniTreeNodes(
  nodes: MiniTreeNode[]
): PositionedMiniTreeNode[] {
  const limited = nodes.slice(0, 16);
  const byId = new Map(limited.map((node) => [node.id, node]));
  const depthById = new Map<string, number>();
  const childrenById = new Map<string, MiniTreeNode[]>();
  const slotById = new Map<string, number>();
  const positionedIds = new Set<string>();
  let nextLeafSlot = 0;

  for (const node of limited) {
    if (!node.parentId || !byId.has(node.parentId)) continue;
    childrenById.set(node.parentId, [
      ...(childrenById.get(node.parentId) ?? []),
      node,
    ]);
  }

  const getDepth = (node: MiniTreeNode, seen = new Set<string>()): number => {
    if (depthById.has(node.id)) return depthById.get(node.id) ?? 0;
    if (!node.parentId || !byId.has(node.parentId) || seen.has(node.id)) {
      depthById.set(node.id, 0);
      return 0;
    }
    const parent = byId.get(node.parentId);
    if (!parent) return 0;
    const depth = getDepth(parent, new Set(seen).add(node.id)) + 1;
    depthById.set(node.id, depth);
    return depth;
  };

  const assignSlot = (node: MiniTreeNode, seen = new Set<string>()): number => {
    if (slotById.has(node.id)) return slotById.get(node.id) ?? 0;
    if (seen.has(node.id)) {
      const slot = nextLeafSlot++;
      slotById.set(node.id, slot);
      return slot;
    }
    const children = childrenById.get(node.id) ?? [];
    if (!children.length) {
      const slot = nextLeafSlot++;
      slotById.set(node.id, slot);
      positionedIds.add(node.id);
      return slot;
    }
    const childSlots = children.map((child) =>
      assignSlot(child, new Set(seen).add(node.id))
    );
    const slot =
      childSlots.reduce((total, value) => total + value, 0) / childSlots.length;
    slotById.set(node.id, slot);
    positionedIds.add(node.id);
    return slot;
  };

  const roots = limited.filter(
    (node) => !node.parentId || !byId.has(node.parentId)
  );
  for (const root of roots) assignSlot(root);
  for (const node of limited) {
    if (!positionedIds.has(node.id)) assignSlot(node);
    getDepth(node);
  }

  const maxDepth = Math.max(1, ...depthById.values());
  const slotCount = Math.max(1, nextLeafSlot);

  return limited.map((node) => {
    const depth = depthById.get(node.id) ?? 0;
    const usableWidth = MINI_TREE_WIDTH - MAP_PADDING_X * 2;
    const slot = slotById.get(node.id) ?? 0;
    const x =
      slotCount === 1
        ? MINI_TREE_WIDTH / 2
        : MAP_PADDING_X +
          (usableWidth * slot) / Math.max(1, slotCount - 1);
    const usableHeight = MINI_TREE_HEIGHT - MAP_PADDING_Y * 2;
    const y =
      MINI_TREE_HEIGHT -
      MAP_PADDING_Y -
      (usableHeight * depth) / maxDepth;
    return { ...node, x, y };
  });
}
