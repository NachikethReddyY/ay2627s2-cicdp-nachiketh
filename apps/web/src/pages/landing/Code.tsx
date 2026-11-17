import type { ReactNode } from "react";

const TOKEN = /("[^"]*"|\/\/.*|\b(?:const|let|function|return|for)\b|\b\d+(?:\.\d+)?\b)/g;

function highlight(line: string): ReactNode[] {
  return line.split(TOKEN).map((part, i) => {
    if (i % 2 === 0) return part;
    const kind = part.startsWith('"') ? "str" : part.startsWith("//") ? "cm" : /^\d/.test(part) ? "num" : "kw";
    return <span key={i} className={`lp-tk-${kind}`}>{part}</span>;
  });
}

type Props = {
  file: string;
  lines: string[];
  mark?: number;
};

export function Code({ file, lines, mark }: Props) {
  return (
    <div className="lp-code">
      <p className="lp-code-file">{file}</p>
      <div className="lp-code-lines" role="group" aria-label={`${file}, ${lines.length} lines`}>
        {lines.map((line, i) => (
          <div key={i} className={mark === i + 1 ? "lp-ln is-mark" : "lp-ln"}>
            <span className="lp-n" aria-hidden>{i + 1}</span>
            <code>{highlight(line)}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
