import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** `text-accent` (the default link color) is the same orange as the user bubble's own
 * background — invisible on it. `onAccent` swaps in the bubble's foreground color
 * instead, so links stay readable there without needing a CSS-cascade override that'd
 * have to fight the component's own inline className. */
function makeComponents(linkClassName: string): Components {
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
      <pre
        className="my-1.5 overflow-x-auto rounded-md border border-border bg-black/30 p-2 font-mono text-xs"
        {...props}
      >
        {children}
      </pre>
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

const defaultComponents = makeComponents("text-accent underline hover:text-accent-hover");
const onAccentComponents = makeComponents("text-accent-foreground underline hover:opacity-80");

interface MarkdownProps {
  text: string;
  /** For markdown rendered on top of the accent-colored (orange) user bubble — the
   * default link color is the same orange as that background. */
  onAccent?: boolean;
}

export function Markdown({ text, onAccent }: MarkdownProps) {
  return (
    <div className="min-w-0 break-words text-sm leading-snug">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={onAccent ? onAccentComponents : defaultComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
