import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUp, ArrowUpToLine, Check, ChevronDown, ChevronRight, CircleX, Copy, GripVertical, ImagePlus, Paperclip, Play, Plus, Redo2, RotateCcw, Square, StepForward, TriangleAlert, X, type LucideIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { SOON, Soon, type NavView } from "./Planned";
import type { WorkbenchProblem } from "./context";
import { askEditorGuide, type GuideWidget } from "../runPython";

// Sample-text views for the planned parts (showPlanned). Static text from the design, not lesson content.
// Loaded lazily by the workbench.

const icon = (I: LucideIcon, size = 15) => <I size={size} strokeWidth={1.8} aria-hidden="true" />;

/** Run / Stop pill at the end of the navigator head (the design's run controls). */
export function RunStopPill() {
  return (
    <span className="wb-pill ml-auto gap-0 shadow-[0_1px_2px_rgba(20,30,70,.1)]">
      <Soon label="Run" className="wb-tb wb-nb">
        <Play size={12} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
      </Soon>
      <span aria-hidden="true" className="h-[18px] w-px bg-[var(--line)]" />
      <Soon label="Stop" className="wb-tb wb-nb" style={{ color: "var(--bad)" }}>
        <Square size={10} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
      </Soon>
    </span>
  );
}

type GuideMessage = { role: "user" | "assistant"; text: string; widgets?: GuideWidget[] };
type GuideImage = { id: string; name: string; url: string };

function GuideWidgetCard({ widget }: { widget: GuideWidget }) {
  return <aside className="wb-ai-widget">
    {widget.type === "hint" ? <><strong>{widget.title}</strong><p>{widget.body}</p></> : widget.type === "steps" ? <><strong>{widget.title}</strong><ol>{widget.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol></> : <><strong>Think about this</strong><p>{widget.text}</p></>}
  </aside>;
}

// Must match the `code` max in GuideBody (apps/api/src/dev/route.ts).
const GUIDE_CODE_LIMIT = 12_000;

/** Fits the buffer into the guide's code limit, growing a window of lines around the selection (or the file start when there is none). */
function clipGuideCode(code: string, selection: { startLine: number; endLine: number } | null) {
  if (code.length <= GUIDE_CODE_LIMIT) return { code, clipped: false, fromStart: false };
  const lines = code.split("\n");
  // Monaco line numbers are 1-based. AIGuide gets no cursor position, so without a selection the window starts at line 1.
  const centre = selection ? Math.min(lines.length - 1, Math.max(0, Math.round((selection.startLine + selection.endLine) / 2) - 1)) : 0;
  let lo = centre;
  let hi = centre;
  let size = lines[centre].length;
  let grew = true;
  while (grew) {
    grew = false;
    if (lo > 0 && size + lines[lo - 1].length + 1 <= GUIDE_CODE_LIMIT) { lo--; size += lines[lo].length + 1; grew = true; }
    if (hi < lines.length - 1 && size + lines[hi + 1].length + 1 <= GUIDE_CODE_LIMIT) { hi++; size += lines[hi].length + 1; grew = true; }
  }
  return { code: lines.slice(lo, hi + 1).join("\n").slice(0, GUIDE_CODE_LIMIT), clipped: true, fromStart: !selection };
}

/** A useful, source-aware learning guide for the isolated /test/editor fixture. */
// The guide sends the current editor context to the server-side AI engine.
export function AIGuide({ fileName, filePath, projectRoot, code, language, selection }: { fileName: string; filePath: string; projectRoot: string; code: string; language: string; selection: { startLine: number; endLine: number; text: string } | null }) {
  const guideCode = clipGuideCode(code, selection);
  const [messages, setMessages] = useState<GuideMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [images, setImages] = useState<GuideImage[]>([]);
  const [showAttachments, setShowAttachments] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageUrls = useRef(new Set<string>());
  const requestId = useRef(0);
  const clearImages = () => {
    images.forEach((image) => URL.revokeObjectURL(image.url));
    imageUrls.current.clear();
    setImages([]);
  };
  useEffect(() => {
    requestId.current++;
    setMessages([]);
    setSending(false);
    setChatError("");
    setImages([]);
    setShowAttachments(false);
  }, [filePath]);
  useEffect(() => () => {
    imageUrls.current.forEach((url) => URL.revokeObjectURL(url));
    imageUrls.current.clear();
  }, [filePath]);
  const ask = async (prompt: string) => {
    if (sending) return;
    const id = ++requestId.current;
    const next: GuideMessage[] = [...messages, { role: "user", text: prompt }];
    setMessages(next);
    setSending(true);
    setChatError("");
    try {
      const { guide } = await askEditorGuide({
        fileName,
        projectRoot,
        language,
        code: guideCode.code,
        selection: selection?.text ?? "",
        messages: next.slice(-8).map(({ role, text }) => ({ role, content: text })),
      });
      if (id === requestId.current) setMessages((current) => [...current, { role: "assistant", text: guide.message, widgets: guide.widgets }]);
    } catch (error) {
      if (id === requestId.current) setChatError(error instanceof Error ? error.message : "The AI guide could not reply. Try again shortly.");
    } finally {
      if (id === requestId.current) setSending(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || sending) return;
    setQuestion("");
    void ask(value);
  };
  const quickActions = ["Explain this", "Give me a hint", "Debug this code", "Find a bug", "Write a test"];
  return (
    <section className="wb-ai-guide flex h-full min-h-0 min-w-0 flex-1 flex-col" aria-label="AI learning guide">
      <div className="wb-ai-head">
        <button className="wb-ai-iconbtn" type="button" aria-label="New chat" title="New chat" onClick={() => { requestId.current++; setSending(false); setMessages([]); setChatError(""); clearImages(); }}><Plus size={18} /></button>
        <div className="wb-ai-avatar" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="54" height="54">
            <defs><linearGradient id="sloppy-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7fb2ff" /><stop offset="1" stopColor="#2f5fd6" /></linearGradient></defs>
            <path d="M24 4c6 0 9 3 13 7 4 4 7 7 7 13s-3 9-7 13c-4 4-7 7-13 7s-9-3-13-7C7 33 4 30 4 24s3-9 7-13c4-4 7-7 13-7z" fill="url(#sloppy-gradient)" />
            <path d="M24 9c1-4 4-6 8-6-.5 4-3 7-8 6z" fill="#4a7bf0" />
            <rect x="15" y="17" width="19" height="15" rx="7" fill="#fff" /><circle cx="26" cy="24" r="4.2" fill="#111" />
          </svg>
        </div>
        <button type="button" className="wb-ai-name" aria-label="Sloppy assistant">Sloppy</button>
      </div>
      <div className="wb-scroll min-h-0 flex-1 px-3.5 pb-3 pt-2 leading-normal">
        <div className="wb-ai-thread" aria-live="polite">
          {messages.length === 0 ? <>
          <div className="wb-ai-time">Code guide · {fileName}</div>
          <div className="wb-ai-reply">Ask me about this file. I’ll help you work it out with clues and questions, without giving away the solution.</div>
          </> : messages.map((message, index) => message.role === "user" ? <div key={`${index}-${message.text}`} className="wb-ai-user">{message.text}</div> : <div key={`${index}-${message.text}`} className="wb-ai-reply wb-ai-markdown"><ReactMarkdown>{message.text}</ReactMarkdown>{message.widgets?.map((widget, widgetIndex) => <GuideWidgetCard key={`${index}-${widgetIndex}`} widget={widget} />)}</div>)}
          {sending && <div role="status" className="wb-ai-reply flex items-center gap-2"><span className="wb-ai-spinner" aria-hidden="true" />Thinking through a clue…</div>}
          {chatError && <div role="alert" className="wb-ai-error">{chatError}</div>}
        </div>
        <div className="wb-ai-quick-actions mt-3 flex flex-wrap gap-1.5">
          {quickActions.map((prompt) => <button key={prompt} type="button" className="wb-ai-prompt" disabled={sending} onClick={() => void ask(prompt)}>{prompt}</button>)}
        </div>
      </div>
      <form className="wb-ask wb-ai-composer" onSubmit={submit}>
        {(selection || guideCode.clipped || images.length > 0) && <div className="wb-ai-context" aria-label="Attached context">
          {guideCode.clipped && <span className="wb-ai-context-chip" title={guideCode.fromStart ? "The cursor position is not available here, so the guide sees the start of the file." : "The guide sees the lines around your selection."}>
            <span className="wb-ai-context-lines">{guideCode.fromStart ? "Showing the start of this file" : "Showing part of this file"}</span>
          </span>}
          {selection && <span className="wb-ai-context-chip" title={`${fileName} · Lines ${selection.startLine}${selection.endLine !== selection.startLine ? `–${selection.endLine}` : ""}`}>
            <span className="wb-ai-context-file">{fileName}</span><span className="wb-ai-context-lines">Lines {selection.startLine}{selection.endLine !== selection.startLine ? `–${selection.endLine}` : ""}</span>
          </span>}
          {images.map((image) => <span className="wb-ai-context-chip wb-ai-image-chip" key={image.id} title={image.name}>
            <img src={image.url} alt="" /><span className="wb-ai-context-file">{image.name}</span><button type="button" aria-label={`Remove ${image.name}`} onClick={() => { URL.revokeObjectURL(image.url); imageUrls.current.delete(image.url); setImages((current) => current.filter((item) => item.id !== image.id)); }}><X size={11} /></button>
          </span>)}
        </div>}
        <div className="wb-ai-input-row">
          <span className="wb-ai-attach-wrap">
            <button type="button" className="wb-ai-attach" aria-label="Add attachment" title="Image attachments are not sent to the guide yet" disabled aria-expanded={showAttachments} onClick={() => setShowAttachments((open) => !open)}><Paperclip size={16} /></button>
            {showAttachments && <span className="wb-ai-attach-menu" role="menu" aria-label="Attach image">
              <button type="button" role="menuitem" onClick={() => imageInput.current?.click()}><ImagePlus size={15} />Add images</button>
            </span>}
            <input ref={imageInput} className="sr-only" type="file" accept="image/*" multiple aria-label="Choose images to attach" onChange={(event) => {
              const remaining = Math.max(0, 5 - images.length);
              const selected = Array.from(event.currentTarget.files ?? []).filter((file) => file.type.startsWith("image/") && file.size <= 10 * 1024 * 1024).slice(0, remaining);
              const added = selected.map((file) => {
                const url = URL.createObjectURL(file);
                imageUrls.current.add(url);
                return { id: crypto.randomUUID(), name: file.name, url };
              });
              if (added.length) setImages((current) => [...current, ...added]);
              event.currentTarget.value = "";
              setShowAttachments(false);
            }} />
          </span>
          <label htmlFor="wb-guide-question" className="sr-only">Ask about this code</label>
          <textarea id="wb-guide-question" rows={1} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about this code" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <button type="submit" className="wb-send" aria-label="Send" disabled={!question.trim() || sending}><ArrowUp size={15} strokeWidth={2} aria-hidden="true" /></button>
        </div>
      </form>
    </section>
  );
}

/** The floating debug bar over the editor. */
export function DebugBar() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  return (
    <div className="wb-debugbar" role="toolbar" aria-label="Debug" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
      <button type="button" className="wb-tb wb-debug-grip" aria-label="Move debugger toolbar" title="Drag to move" onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
      }} onPointerMove={(event) => {
        if (!drag.current) return;
        setOffset({ x: drag.current.offsetX + event.clientX - drag.current.x, y: drag.current.offsetY + event.clientY - drag.current.y });
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <GripVertical size={13} aria-hidden="true" />
      </button>
      <Soon label="Continue" style={{ color: "var(--acT)" }}>{icon(StepForward)}</Soon>
      <Soon label="Step over">{icon(Redo2)}</Soon>
      <Soon label="Step into">{icon(ArrowDownToLine)}</Soon>
      <Soon label="Step out">{icon(ArrowUpToLine)}</Soon>
      <Soon label="Restart">{icon(RotateCcw)}</Soon>
      <Soon label="Stop debugging" style={{ color: "#d64545" }}>
        <Square size={13} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
      </Soon>
    </div>
  );
}

/** Sample output for the bottom panel's Debug console tab. */
export function DebugConsole() {
  return (
    <div className="wb-mono px-3.5 py-2 text-xs leading-[1.65]">
      <div className="text-[var(--mu)]">Paused on breakpoint · trace-loop.ts:10</div>
      <div>
        <span className="text-[var(--mu)]">&gt;</span> total + i
      </div>
      <div className="text-[var(--nu)]">3</div>
      <div>
        <span className="text-[var(--mu)]">&gt;</span> <span className="wb-caret" />
      </div>
    </div>
  );
}

const IND: CSSProperties = { paddingLeft: 22 };

const Chip = ({ children, mono = false }: { children: ReactNode; mono?: boolean }) => <span className={`wb-chip ${mono ? "wb-mono" : ""}`}>{children}</span>;

const Sec = ({ children, open = false }: { children: ReactNode; open?: boolean }) => (
  <div className="wb-sec">
    {open && <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />}
    {children}
  </div>
);

/** Static navigator views for the tabs that are not built yet. */
export function PlannedNavView({ view, problems = [], branch = "main" }: { view: Exclude<NavView, "files">; problems?: WorkbenchProblem[]; branch?: string }) {
  switch (view) {
    case "search":
      return (
        <>
          <div className="px-2.5 pb-2 pt-1">
            <label htmlFor="wb-soon-search" className="wb-sec mb-1.5 h-auto p-0">
              Search
            </label>
            <input id="wb-soon-search" type="text" readOnly aria-disabled="true" title={SOON} placeholder="Find in project" className="wb-field" />
            <div className="mt-2 flex gap-1.5">
              <Chip mono>Aa</Chip>
              <Chip mono>.*</Chip>
              <Chip>files to include</Chip>
            </div>
          </div>
          <p className="px-2.5 py-2.5 text-[var(--mu)]">Type to search across apps, packages and services.</p>
        </>
      );
    case "git":
      return (
        <>
          <Sec>
            Changes<span className="ml-auto">2</span>
          </Sec>
          <div className="wb-tree">
            <span className="wb-dot-sq" style={{ background: "#3178c6" }} />
            trace-loop.ts
            <span className="wb-mono wb-git-m">M</span>
          </div>
          <div className="wb-tree">
            <span className="wb-dot-sq" style={{ background: "#3178c6" }} />
            timeline.test.ts
            <span className="wb-mono ml-auto text-[var(--ok)]">A</span>
          </div>
          <div className="p-2.5">
            <Soon label="Commit" className="wb-tb wb-primary h-[30px] w-full">
              Commit…
            </Soon>
          </div>
          <Sec>Branch</Sec>
          <div className="wb-tree wb-mono">{branch}</div>
        </>
      );
    case "problems":
      return <ProblemsView problems={problems} />;
    case "debug":
      return (
        <>
          <Sec open>Variables</Sec>
          {[
            ["limit", "5"],
            ["i", "2"],
            ["total", "1"],
          ].map(([k, v]) => (
            <div key={k} className="wb-tree wb-mono" style={IND}>
              <span className="text-[var(--mu)]">{k}</span>
              <span className="ml-auto text-[var(--nu)]">{v}</span>
            </div>
          ))}
          <div className="wb-tree wb-mono" style={IND}>
            <span className="text-[var(--mu)]">frames</span>
            <span className="ml-auto text-[var(--mu)]">Array(2)</span>
          </div>
          <div className="mt-2" />
          <Sec open>Call stack</Sec>
          <div className="wb-tree wb-mono" style={IND}>
            <span className="text-[var(--fn)]">traceLoop</span>
            <span className="ml-auto text-[var(--mu)]">:10</span>
          </div>
          <div className="wb-tree wb-mono" style={IND}>
            <span className="text-[var(--mu)]">(anonymous)</span>
            <span className="ml-auto text-[var(--mu)]">:18</span>
          </div>
          <div className="mt-2" />
          <Sec open>Breakpoints</Sec>
          <div className="wb-tree" style={IND}>
            <span className="size-[9px] flex-none rounded-full bg-[#d64545]" />
            trace-loop.ts
            <span className="wb-mono ml-auto text-[var(--mu)]">10</span>
          </div>
        </>
      );
  }
}

function ProblemsView({ problems }: { problems: WorkbenchProblem[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const byFile = new Map<string, WorkbenchProblem[]>();
  for (const problem of problems) byFile.set(problem.fileName, [...(byFile.get(problem.fileName) ?? []), problem]);
  const copyProblems = async (key: string, entries: WorkbenchProblem[]) => {
    const groupedFiles = [...new Set(entries.map((problem) => problem.fileName))];
    const text = [
      "Help me debug these code problems. Explain the cause in plain language, then suggest the smallest safe fix. Keep unrelated code unchanged.",
      ...groupedFiles.map((fileName) => {
        const fileProblems = entries.filter((problem) => problem.fileName === fileName);
        return `\n## ${fileName}\n${fileProblems.map((problem) => [
          `- ${problem.severity.toUpperCase()} on line ${problem.line}: ${problem.title}`,
          `  What it means: ${problem.explanation}`,
          problem.diagnostic ? `  Editor diagnostic: ${problem.diagnostic}` : "",
          problem.codeContext ? `  Nearby code:\n  \`\`\`\n${problem.codeContext.split("\n").map((line) => `  ${line}`).join("\n")}\n  \`\`\`` : "",
        ].filter(Boolean).join("\n")).join("\n")}`;
      }),
    ].join("\n");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement("textarea");
        input.value = text;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        const success = document.execCommand("copy");
        input.remove();
        if (!success) throw new Error("Clipboard unavailable");
      }
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? null : current), 1600);
    } catch {
      setCopied(`failed-${key}`);
      window.setTimeout(() => setCopied((current) => current === `failed-${key}` ? null : current), 2400);
    }
  };
  return (
    <>
      <div className="flex min-h-9 items-center gap-2 border-b border-[var(--line)]/70 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--mu)]">
        <span>Problems</span><span>{problems.length}</span>
        {problems.length > 0 && <button type="button" className="wb-tb ml-auto min-h-7 px-2 text-[10px] normal-case tracking-normal" aria-label="Copy all problems" onClick={() => void copyProblems("all", problems)}>
          {copied === "all" ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          {copied === "all" ? "Copied" : copied === "failed-all" ? "Copy failed" : "Copy all"}
        </button>}
      </div>
      {byFile.size === 0 ? (
        <p className="px-3 py-2 leading-normal text-[var(--mu)]">No problems found in the open file.</p>
      ) : [...byFile].map(([fileName, fileProblems]) => {
        const isOpen = expanded.has(fileName);
        const errors = fileProblems.filter((problem) => problem.severity === "error").length;
        const warnings = fileProblems.length - errors;
        return (
          <section key={fileName} className="border-b border-[var(--line)]/70">
            <button type="button" aria-expanded={isOpen} onClick={() => setExpanded((current) => {
              const next = new Set(current);
              if (next.has(fileName)) next.delete(fileName); else next.add(fileName);
              return next;
            })} className="flex min-h-9 w-full items-center gap-1.5 px-2.5 text-left hover:bg-[var(--hover)]">
              {isOpen ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate" title={fileName}>{fileName}</span>
              {errors > 0 && <span className="flex items-center gap-1 text-[var(--bad)]"><CircleX size={13} aria-hidden="true" />{errors}</span>}
              {warnings > 0 && <span className="flex items-center gap-1 text-[var(--warn)]"><TriangleAlert size={13} aria-hidden="true" />{warnings}</span>}
            </button>
            {isOpen && <ul className="pb-1">
              {fileProblems.map((problem, index) => {
                const copyKey = `problem-${problem.fileName}-${problem.line}-${index}`;
                return <li key={`${problem.line}-${problem.title}-${index}`} className="px-3 pb-2 pl-8">
                  <div className="flex items-start gap-1.5">
                      {problem.severity === "error" ? <CircleX className="mt-0.5 shrink-0 text-[var(--bad)]" size={13} aria-hidden="true" /> : <TriangleAlert className="mt-0.5 shrink-0 text-[var(--warn)]" size={13} aria-hidden="true" />}
                      <div className="min-w-0 flex-1">
                        <p className="leading-snug">{problem.title}<span className="ml-1 text-[var(--mu)]">· line {problem.line}</span></p>
                        <p className="mt-0.5 leading-snug text-[var(--mu)]">{problem.explanation}</p>
                      </div>
                      <button type="button" className="wb-tb wb-n34 -mt-1 h-7 w-7 shrink-0" title={copied === `failed-${copyKey}` ? "Copy failed" : "Copy this problem"} aria-label={`Copy problem in ${problem.fileName} on line ${problem.line}`} onClick={() => void copyProblems(copyKey, [problem])}>
                        {copied === copyKey ? <Check size={13} aria-hidden="true" /> : copied === `failed-${copyKey}` ? "!" : <Copy size={13} aria-hidden="true" />}
                      </button>
                  </div>
                </li>
              })}
            </ul>}
          </section>
        );
      })}
    </>
  );
}
