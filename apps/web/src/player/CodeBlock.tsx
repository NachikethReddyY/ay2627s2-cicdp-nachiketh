import { useRef, useState, type ComponentProps, Children, isValidElement, type ReactElement } from "react";
import { Check, Copy, WrapText } from "lucide-react";
import { FOCUS } from "./ui";

// A code block from the lesson text, with the language, a copy button and a wrap toggle above it.
export function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  // rehype-highlight puts the language on the <code> child as "language-python".
  const code = Children.toArray(children).find(isValidElement) as ReactElement<{ className?: string }> | undefined;
  const lang = /language-([\w+#-]+)/.exec(code?.props.className ?? "")?.[1];
  const label = lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : "Code";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref.current?.textContent ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The browser refused the clipboard; the code stays selectable by hand.
    }
  };

  return (
    <div className="code-block">
      <div className="code-toolbar" role="toolbar" aria-label={`${label} code`}>
        <span className="code-actions">
        <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy code"} className={FOCUS}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => setWrap(!wrap)} aria-pressed={wrap} aria-label="Wrap long lines" className={FOCUS}>
          <WrapText size={16} aria-hidden="true" />
        </button>
        </span>
      </div>
      <pre ref={ref} tabIndex={0} className={`chunk p-4 text-sm ${wrap ? "code-wrap" : "overflow-x-auto"} ${FOCUS}`} {...props}>
        {children}
      </pre>
      <span className="code-lang">{label}</span>
    </div>
  );
}
