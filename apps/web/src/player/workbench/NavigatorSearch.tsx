import { useContext, useState } from "react";
import { DrawerCloseContext } from "./TreeRow";

type Props = {
  fileName: string;
  code: string;
  onSelect(line: number): void;
};

export default function NavigatorSearch({ fileName, code, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const closeDrawer = useContext(DrawerCloseContext);
  const needle = query.trim().toLowerCase();
  const matches = needle ? code.split(/\r\n|\r|\n/).flatMap((text, index) => {
    return text.toLowerCase().includes(needle) ? [{ line: index + 1, text }] : [];
  }) : [];

  return (
    <section aria-label="Search the open file" className="min-w-0 p-3">
      <label className="flex flex-col gap-1 text-[var(--mu)]">
        Find in file
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="wb-field" />
      </label>
      <div className="wb-mono mt-2 truncate text-xs text-[var(--mu)]" title={fileName}>{fileName}</div>
      {needle && matches.length === 0 && <p role="status" className="mt-2 text-[var(--mu)]">No matching lines.</p>}
      {matches.length > 0 && <ul className="mt-2">
        {matches.map(({ line, text }) => (
          <li key={line}>
            <button type="button" className="wb-mono flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-xs hover:bg-[var(--hov)]"
              title={text.trim()} onClick={() => closeDrawer ? closeDrawer(() => onSelect(line)) : onSelect(line)}>
              <span className="shrink-0 text-[var(--mu)]">{line}</span>
              <span className="truncate">{text.trim()}</span>
            </button>
          </li>
        ))}
      </ul>}
    </section>
  );
}
