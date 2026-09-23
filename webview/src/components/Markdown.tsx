import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Check, Copy } from "lucide-react";
import { Tooltip } from "./Tooltip";

/** Pulls the plain-text content back out of a `code` block's already-rendered React
 * children — needed because react-markdown hands custom components rendered nodes, not
 * the raw source string, and there's no other hook to grab it from for the copy button. */
function nodeToText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return nodeToText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function CopyCodeButton({ text, onCopy }: { text: string; onCopy: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip label={copied ? "Copied!" : "Copy code"}>
      <button
        onClick={() => {
          onCopy(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute top-1.5 right-1.5 cursor-pointer rounded-md bg-black/40 p-1 text-muted opacity-0 hover:text-foreground group-hover:opacity-100"
        aria-label="Copy code"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </Tooltip>
  );
}

/** `text-accent` (the default link color) is the same orange as the user bubble's own
 * background — invisible on it. `onAccent` swaps in the bubble's foreground color
 * instead, so links stay readable there without needing a CSS-cascade override that'd
 * have to fight the component's own inline className. `onCopyCode`, when provided, adds
 * a hover copy button to every code block (fenced ``` blocks render as `pre` wrapping
 * `code`; inline `code` has no `pre` ancestor and intentionally gets no button). */
function makeComponents(linkClassName: string, onCopyCode?: (text: string) => void): Components {
  return {
    a: ({ children, ...props }) => (
      <a {...props} className={linkClassName} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
    code: ({ className, children, ...props }) => {
      const isBlock = Boolean(className);
      if (isBlock) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      return (
        <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[0.85em]" {...props}>
          {children}
        </code>
      );
    },
    pre: ({ children, ...props }) => (
      <div className="group relative my-1.5">
        <pre className="overflow-x-auto rounded-md border border-border bg-black/30 p-2 font-mono text-xs" {...props}>
          {children}
        </pre>
        {onCopyCode && <CopyCodeButton text={nodeToText(children)} onCopy={onCopyCode} />}
      </div>
    ),
    ul: ({ children, ...props }) => (
      <ul className="my-1 list-disc pl-5" {...props}>
        {children}
      </ul>
    ),
    ol: ({ children, ...props }) => (
      <ol className="my-1 list-decimal pl-5" {...props}>
        {children}
      </ol>
    ),
    p: ({ children, ...props }) => (
      <p className="[&:not(:first-child)]:mt-1.5" {...props}>
        {children}
      </p>
    ),
    h1: ({ children, ...props }) => (
      <h1 className="mt-2 mb-1 text-base font-semibold" {...props}>
        {children}
      </h1>
    ),
    h2: ({ children, ...props }) => (
      <h2 className="mt-2 mb-1 text-sm font-semibold" {...props}>
        {children}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3 className="mt-2 mb-1 text-sm font-semibold" {...props}>
        {children}
      </h3>
    ),
    blockquote: ({ children, ...props }) => (
      <blockquote className="my-1.5 border-l-2 border-border pl-2 text-muted" {...props}>
        {children}
      </blockquote>
    ),
    table: ({ children, ...props }) => (
      <table className="my-1.5 border-collapse text-xs" {...props}>
        {children}
      </table>
    ),
    th: ({ children, ...props }) => (
      <th className="border border-border px-1.5 py-0.5 text-left" {...props}>
        {children}
      </th>
    ),
    td: ({ children, ...props }) => (
      <td className="border border-border px-1.5 py-0.5" {...props}>
        {children}
      </td>
    ),
  };
}

interface MarkdownProps {
  text: string;
  /** For markdown rendered on top of the accent-colored (orange) user bubble — the
   * default link color is the same orange as that background. */
  onAccent?: boolean;
  /** Adds a hover copy button to every code block when provided — omit to render
   * without one (e.g. UsageDialog's markdown, which has no clipboard handler wired). */
  onCopyCode?: (text: string) => void;
}

export function Markdown({ text, onAccent, onCopyCode }: MarkdownProps) {
  const linkClassName = onAccent
    ? "text-accent-foreground underline hover:opacity-80"
    : "text-accent underline hover:text-accent-hover";
  // Recomputed only when these actually change, rather than on every token appended
  // while a response streams in — `components` is a fresh object either way, but
  // ReactMarkdown re-parses regardless, so this just avoids rebuilding the (fairly
  // large) component map on every keystroke/delta for no reason.
  const components = useMemo(() => makeComponents(linkClassName, onCopyCode), [linkClassName, onCopyCode]);
  return (
    <div className="min-w-0 break-words text-sm leading-snug">
      <ReactMarkdown
        // CommonMark treats a single "\n" as a soft break (rendered as just a space),
        // which is why Shift+Enter's newline in the composer's textarea disappeared
        // once rendered — remark-breaks turns every single newline into a hard <br>
        // instead, matching what was actually typed.
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
