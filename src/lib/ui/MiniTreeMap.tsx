"use client";

import clsx from "clsx";

export type MiniTreeNode = {
  id: string;
  parentId: string | null;
  label: string;
  relation?: "root" | "child" | "related" | "branch";
  unread?: boolean;
};

type MiniTreeMapProps = {
  nodes: MiniTreeNode[];
  activeId: string | null;
  onSelect: (nodeId: string) => void;
  label: string;
  className?: string;
};

type PositionedNode = MiniTreeNode & {
  x: number;
  y: number;
};

const MAP_WIDTH = 240;
const MAP_HEIGHT = 176;
const MAP_PADDING_X = 24;
const MAP_PADDING_Y = 22;

function positionNodes(nodes: MiniTreeNode[]): PositionedNode[] {
  const limited = nodes.slice(0, 16);
  const byId = new Map(limited.map((node) => [node.id, node]));
  const depthById = new Map<string, number>();

  const getDepth = (node: MiniTreeNode, seen = new Set<string>()): number => {
    if (depthById.has(node.id)) return depthById.get(node.id) ?? 0;
    if (!node.parentId || !byId.has(node.parentId) || seen.has(node.id)) {
      depthById.set(node.id, 0);
      return 0;
    }
    const parent = byId.get(node.parentId);
    if (!parent) return 0;
    const nextSeen = new Set(seen).add(node.id);
    const depth = getDepth(parent, nextSeen) + 1;
    depthById.set(node.id, depth);
    return depth;
  };

  for (const node of limited) getDepth(node);
  const maxDepth = Math.max(1, ...depthById.values());
  const levels = new Map<number, MiniTreeNode[]>();

  for (const node of limited) {
    const depth = depthById.get(node.id) ?? 0;
    levels.set(depth, [...(levels.get(depth) ?? []), node]);
  }

  return limited.map((node) => {
    const depth = depthById.get(node.id) ?? 0;
    const peers = levels.get(depth) ?? [node];
    const index = peers.findIndex((peer) => peer.id === node.id);
    const usableWidth = MAP_WIDTH - MAP_PADDING_X * 2;
    const x =
      peers.length === 1
        ? MAP_WIDTH / 2
        : MAP_PADDING_X + (usableWidth * index) / Math.max(1, peers.length - 1);
    const usableHeight = MAP_HEIGHT - MAP_PADDING_Y * 2;
    const y = MAP_HEIGHT - MAP_PADDING_Y - (usableHeight * depth) / maxDepth;
    return { ...node, x, y };
  });
}

export function MiniTreeMap({
  nodes,
  activeId,
  onSelect,
  label,
  className,
}: MiniTreeMapProps) {
  const positioned = positionNodes(nodes);
  const positionById = new Map(positioned.map((node) => [node.id, node]));

  return (
    <nav className={clsx("magic-mini-tree", className)} aria-label={label}>
      <div className="magic-mini-tree-label">
        <span>{label}</span>
        <i>{nodes.length}</i>
      </div>

      <div className="magic-mini-tree-canvas">
        <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} aria-hidden="true">
          {positioned.map((node) => {
            const parent = node.parentId ? positionById.get(node.parentId) : undefined;
            if (!parent) return null;
            const middleY = parent.y + (node.y - parent.y) * 0.52;
            return (
              <path
                key={`${parent.id}_${node.id}`}
                className={`relation-${node.relation ?? "child"}`}
                d={`M ${parent.x} ${parent.y} C ${parent.x} ${middleY}, ${node.x} ${middleY}, ${node.x} ${node.y}`}
              />
            );
          })}
        </svg>

        {positioned.map((node) => (
          <button
            key={node.id}
            type="button"
            className={clsx(
              "magic-mini-tree-node",
              `relation-${node.relation ?? "child"}`,
              node.id === activeId && "is-active",
              node.unread && "is-unread"
            )}
            style={{ left: node.x, top: node.y }}
            onClick={() => onSelect(node.id)}
            aria-label={`定位到：${node.label}`}
            title={node.label}
          >
            <span />
          </button>
        ))}
      </div>
    </nav>
  );
}
