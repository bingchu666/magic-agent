import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type AssistantMarkdownProps = {
  content: string;
};

export const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
}: AssistantMarkdownProps) {
  return (
    <div className="prose prose-zinc max-w-none text-[15px] leading-7 prose-p:my-2 prose-headings:my-3 prose-hr:my-4 prose-ul:my-2 prose-ol:my-2 prose-li:my-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
});
