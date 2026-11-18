const STRUCTURE = /^\s*(?:[-*+]\s|\d+[.)]\s|#|>|\|)/;

export function keepLineBreaks(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```)/g)
    .map((part) => (part.startsWith("```") ? part : joinProse(part)))
    .join("");
}

function joinProse(text: string): string {
  const lines = text.split("\n");
  let out = lines[0] ?? "";
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1] ?? "";
    const cur = lines[i] ?? "";
    if (prev.trim() === "" || cur.trim() === "") out += "\n" + cur;
    else if (STRUCTURE.test(prev) || STRUCTURE.test(cur)) out += "  \n" + cur;
    else out += "\n\n" + cur;
  }
  return out;
}
