export type MiniTreeNode = {
  id: string;
  parentId: string | null;
  label: string;
  eyebrow?: string;
  summary?: string;
  relation?: "root" | "child" | "related" | "branch";
  unread?: boolean;
};

export type PositionedMiniTreeNode = MiniTreeNode & {
  x: number;
  y: number;
};

// x is a percentage (0-100) of the canvas width, so the tree lays out
// correctly whether the canvas is a fixed-size box or a fluid sidebar.
export const MINI_TREE_VIEWBOX_WIDTH = 100;
// y is in pixels and grows with tree depth (see getMiniTreeCanvasHeight),
// so a persistent sidebar can show deep trees with a vertical scrollbar
// instead of squeezing everything into a fixed-size box.
export const MINI_TREE_MIN_HEIGHT = 176;
const PADDING_X = 10;
const PADDING_Y = 22;
const ROW_HEIGHT = 64;

function computeDepths(nodes: MiniTreeNode[]): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depthById = new Map<string, number>();

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

  for (const node of nodes) getDepth(node);
  return depthById;
}

export function getMiniTreeCanvasHeight(nodes: MiniTreeNode[]): number {
  const depthById = computeDepths(nodes);
  const maxDepth = Math.max(0, ...depthById.values());
  return Math.max(MINI_TREE_MIN_HEIGHT, PADDING_Y * 2 + maxDepth * ROW_HEIGHT);
}

export function positionMiniTreeNodes(
  nodes: MiniTreeNode[]
): PositionedMiniTreeNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenById = new Map<string, MiniTreeNode[]>();
  const slotById = new Map<string, number>();
  const positionedIds = new Set<string>();
  let nextLeafSlot = 0;

  for (const node of nodes) {
    if (!node.parentId || !byId.has(node.parentId)) continue;
    childrenById.set(node.parentId, [
      ...(childrenById.get(node.parentId) ?? []),
      node,
    ]);
  }

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

  const roots = nodes.filter(
    (node) => !node.parentId || !byId.has(node.parentId)
  );
  for (const root of roots) assignSlot(root);
  for (const node of nodes) {
    if (!positionedIds.has(node.id)) assignSlot(node);
  }

  const depthById = computeDepths(nodes);
  const maxDepth = Math.max(1, ...depthById.values());
  const slotCount = Math.max(1, nextLeafSlot);
  const height = Math.max(MINI_TREE_MIN_HEIGHT, PADDING_Y * 2 + maxDepth * ROW_HEIGHT);
  const usableWidth = MINI_TREE_VIEWBOX_WIDTH - PADDING_X * 2;
  const usableHeight = height - PADDING_Y * 2;

  return nodes.map((node) => {
    const depth = depthById.get(node.id) ?? 0;
    const slot = slotById.get(node.id) ?? 0;
    const x =
      slotCount === 1
        ? MINI_TREE_VIEWBOX_WIDTH / 2
        : PADDING_X + (usableWidth * slot) / Math.max(1, slotCount - 1);
    const y = height - PADDING_Y - (usableHeight * depth) / maxDepth;
    return { ...node, x, y };
  });
}
