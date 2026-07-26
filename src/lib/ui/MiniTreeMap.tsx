"use client";

import clsx from "clsx";
import {
  MINI_TREE_HEIGHT,
  MINI_TREE_WIDTH,
  positionMiniTreeNodes,
  type MiniTreeNode,
} from "@/lib/ui/mini-tree-layout";

export type { MiniTreeNode } from "@/lib/ui/mini-tree-layout";

type MiniTreeMapProps = {
  nodes: MiniTreeNode[];
  activeId: string | null;
  onSelect: (nodeId: string) => void;
  label: string;
  className?: string;
};

export function MiniTreeMap({
  nodes,
  activeId,
  onSelect,
  label,
  className,
}: MiniTreeMapProps) {
  const positioned = positionMiniTreeNodes(nodes);
  const positionById = new Map(positioned.map((node) => [node.id, node]));
  const activePathIds = new Set<string>();
  let pathNode = activeId ? positionById.get(activeId) : undefined;
  while (pathNode && !activePathIds.has(pathNode.id)) {
    activePathIds.add(pathNode.id);
    pathNode = pathNode.parentId
      ? positionById.get(pathNode.parentId)
      : undefined;
  }

  return (
    <nav className={clsx("magic-mini-tree", className)} aria-label={label}>
      <div className="magic-mini-tree-label">
        <span>{label}</span>
        <i>{nodes.length}</i>
      </div>

      <div className="magic-mini-tree-canvas">
        <svg
          viewBox={`0 0 ${MINI_TREE_WIDTH} ${MINI_TREE_HEIGHT}`}
          aria-hidden="true"
        >
          {positioned.map((node) => {
            const parent = node.parentId ? positionById.get(node.parentId) : undefined;
            if (!parent) return null;
            const middleY = parent.y + (node.y - parent.y) * 0.52;
            return (
              <path
                key={`${parent.id}_${node.id}`}
                className={clsx(
                  `relation-${node.relation ?? "child"}`,
                  activePathIds.has(node.id) && "is-active-path"
                )}
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
              activePathIds.has(node.id) && "is-active-path",
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
