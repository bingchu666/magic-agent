import { memo, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type AssistantMarkdownProps = {
  content: string;
  onConcept?: (term: string, event: MouseEvent<HTMLButtonElement>) => void;
};

export const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
  onConcept,
}: AssistantMarkdownProps) {
  const annotated = content.replace(/\[\[([^\]]+)\]\]/g, (_, term: string) => {
    return `[${term}](concept:${encodeURIComponent(term)})`;
  });

  return (
    <div className="prose prose-zinc max-w-none text-[15px] leading-7 prose-p:my-2 prose-headings:my-3 prose-hr:my-4 prose-ul:my-2 prose-ol:my-2 prose-li:my-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("concept:") && onConcept) {
              const term = decodeURIComponent(href.replace("concept:", ""));
              return (
                <button
                  type="button"
                  className="magic-inline-keyword"
                  onClick={(event) => onConcept(term, event)}
                  title={`继续了解：${term}`}
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          strong: ({ children }) => {
            const term = typeof children === "string" ? children.trim() : "";
            if (onConcept && term.length >= 2 && term.length <= 24) {
              return (
                <button
                  type="button"
                  className="magic-inline-keyword"
                  onClick={(event) => onConcept(term, event)}
                  title={`继续了解：${term}`}
                >
                  {children}
                </button>
              );
            }
            return <strong>{children}</strong>;
          },
        }}
      >
        {annotated}
      </ReactMarkdown>
    </div>
  );
});
