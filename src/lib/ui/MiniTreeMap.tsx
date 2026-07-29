"use client";

import clsx from "clsx";
import { useState } from "react";
import {
  MINI_TREE_VIEWBOX_WIDTH,
  getMiniTreeCanvasHeight,
  positionMiniTreeNodes,
  type MiniTreeNode,
} from "@/lib/ui/mini-tree-layout";

export type { MiniTreeNode } from "@/lib/ui/mini-tree-layout";

type MiniTreeMapProps = {
  nodes: MiniTreeNode[];
  activeId: string | null;
  onSelect: (nodeId: string) => void;
  label: string;
  currentLabel?: string;
  className?: string;
};

type NodePreview = {
  node: MiniTreeNode;
  left: number;
  top: number;
  placement: "above" | "below";
};

export function MiniTreeMap({
  nodes,
  activeId,
  onSelect,
  label,
  currentLabel = "Current",
  className,
}: MiniTreeMapProps) {
  const [preview, setPreview] = useState<NodePreview | null>(null);
  const positioned = positionMiniTreeNodes(nodes);
  const canvasHeight = getMiniTreeCanvasHeight(nodes);
  const positionById = new Map(positioned.map((node) => [node.id, node]));
  const activePathIds = new Set<string>();
  let pathNode = activeId ? positionById.get(activeId) : undefined;
  while (pathNode && !activePathIds.has(pathNode.id)) {
    activePathIds.add(pathNode.id);
    pathNode = pathNode.parentId
      ? positionById.get(pathNode.parentId)
      : undefined;
  }

  const showPreview = (
    node: MiniTreeNode,
    target: HTMLButtonElement
  ) => {
    const rect = target.getBoundingClientRect();
    const treeRect =
      target.closest<HTMLElement>(".magic-mini-tree")?.getBoundingClientRect() ??
      rect;
    const previewWidth = 174;
    const previewHeight = 78;
    const gap = 10;
    const placement = rect.top - previewHeight - gap >= 12 ? "above" : "below";
    setPreview({
      node,
      left: Math.max(
        12,
        Math.min(
          treeRect.left + (treeRect.width - previewWidth) / 2,
          window.innerWidth - previewWidth - 12
        )
      ),
      top:
        placement === "above"
          ? rect.top - previewHeight - gap
          : Math.min(rect.bottom + gap, window.innerHeight - previewHeight - 12),
      placement,
    });
  };

  return (
    <nav className={clsx("magic-mini-tree", className)} aria-label={label}>
      <div className="magic-mini-tree-label">
        <span>{label}</span>
        <i>{nodes.length}</i>
      </div>

      <div className="magic-mini-tree-canvas" style={{ height: canvasHeight }}>
        <svg
          viewBox={`0 0 ${MINI_TREE_VIEWBOX_WIDTH} ${canvasHeight}`}
          preserveAspectRatio="none"
          style={{ height: canvasHeight }}
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
            style={{ left: `${node.x}%`, top: node.y }}
            onClick={() => onSelect(node.id)}
            onMouseEnter={(event) => showPreview(node, event.currentTarget)}
            onMouseLeave={() => setPreview(null)}
            onFocus={(event) => showPreview(node, event.currentTarget)}
            onBlur={() => setPreview(null)}
            aria-label={`定位到：${node.label}`}
            aria-describedby={preview?.node.id === node.id ? `tree_preview_${node.id}` : undefined}
          >
            <span />
          </button>
        ))}
      </div>

      {preview ? (
        <div
          id={`tree_preview_${preview.node.id}`}
          className={clsx(
            "magic-mini-tree-preview",
            `relation-${preview.node.relation ?? "child"}`,
            `is-${preview.placement}`,
            preview.node.id === activeId && "is-active"
          )}
          style={{ left: preview.left, top: preview.top }}
          role="tooltip"
        >
          <span>{preview.node.eyebrow || preview.node.relation || "Card"}</span>
          <strong>{preview.node.label}</strong>
          {preview.node.summary ? <p>{preview.node.summary}</p> : null}
          {preview.node.id === activeId ? <i>{currentLabel}</i> : null}
        </div>
      ) : null}
    </nav>
  );
}
