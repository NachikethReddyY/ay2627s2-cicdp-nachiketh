import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import {
  attrEntries,
  defaultExpanded,
  filterComputed,
  findPath,
  formatBytes,
  formatDuration,
  hasNode,
  isFailedRequest,
  isTextNode,
  parseDeclaration,
  urlName,
  urlPath,
  visibleNetwork,
  visibleRows,
} from "./devtoolsHelpers";
import type {
  DomNode,
  HostToPreview,
  LogLevel,
  NetworkEntry,
  NodeStyles,
  SourceEntry,
  SourceText,
  StyleDeclaration,
} from "./previewDevtoolsProtocol";

export type DevtoolsTab = "elements" | "console" | "sources" | "network";

export type PreviewDevtoolsProps = {
  logs: { level: LogLevel; args: string[]; time: string }[];
  dom: { root: DomNode; truncated: boolean } | null;
  styles: NodeStyles | null;
  network: NetworkEntry[];
  sources: SourceEntry[];
  sourceText: SourceText | null;
  /** The learner clicked an element in inspect mode. Change `seq` each time so the same node can be picked twice. */
  picked: { nodeId: number; seq: number } | null;
  /** Switch to a tab (for example "Inspect element" in the browser menu). Change `seq` each time. */
  openTab: { tab: DevtoolsTab; seq: number } | null;
  inspecting: boolean;
  send(command: HostToPreview): void;
  onClearLogs(): void;
  onToggleInspect(): void;
  onClose(): void;
};

type Send = (command: HostToPreview) => void;

const TABS: { id: DevtoolsTab; label: string }[] = [
  { id: "elements", label: "Elements" },
  { id: "console", label: "Console" },
  { id: "sources", label: "Sources" },
  { id: "network", label: "Network" },
];

/** Keeps the newest callback in a ref so effects can call it without re-running when its identity changes. */
function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export default function PreviewDevtools(props: PreviewDevtoolsProps): ReactElement {
  const { logs, dom, styles, network, sources, sourceText, picked, openTab, inspecting, send, onClearLogs, onToggleInspect, onClose } = props;
  const [tab, setTab] = useState<DevtoolsTab>("elements");
  const [clearedUpTo, setClearedUpTo] = useState(0);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const sendRef = useLatest(send);
  const sourcesAsked = useRef(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hadDom = useRef(dom !== null);
  const uid = useId();

  // The page reloaded and the host dropped its tree: ask for the new one, once per reset.
  useEffect(() => {
    const had = hadDom.current;
    hadDom.current = dom !== null;
    if (had && dom === null && tab === "elements") sendRef.current({ type: "dom-request" });
  }, [dom, tab, sendRef]);

  // After a reset the network ids start over, so an old clear boundary must not hide new requests.
  useEffect(() => {
    if (network.length === 0) setClearedUpTo(0);
  }, [network]);

  useEffect(() => {
    sendRef.current({ type: "dom-request" });
  }, [sendRef]);

  useEffect(() => {
    if (openTab) setTab(openTab.tab);
  }, [openTab]);

  useEffect(() => {
    if (tab === "sources" && !sourcesAsked.current) {
      sourcesAsked.current = true;
      sendRef.current({ type: "sources-request" });
    }
  }, [tab, sendRef]);

  const refresh = (): void => {
    if (tab === "sources") send({ type: "sources-request" });
    else send({ type: "dom-request" });
    setRefreshSeq((n) => n + 1);
  };

  const clearNetwork = (): void => setClearedUpTo(network.reduce((max, entry) => Math.max(max, entry.id), clearedUpTo));

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const at = TABS.findIndex((item) => item.id === tab);
    const next = TABS[(at + step + TABS.length) % TABS.length];
    if (next) {
      setTab(next.id);
      tabRefs.current[(at + step + TABS.length) % TABS.length]?.focus();
    }
  };

  return (
    <section className="wb-preview-devtools" aria-label="Preview developer tools">
      <div className="wb-dt-bar">
        <div className="wb-dt-tabs" role="tablist" aria-label="Developer tools panels" onKeyDown={onTabKey}>
          {TABS.map((item, tabIndex) => (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[tabIndex] = node;
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`${uid}-panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="wb-dt-actions">
          <button type="button" className="wb-dt-btn wb-dt-inspect" aria-pressed={inspecting} aria-label="Select element" title="Select an element in the page" onClick={onToggleInspect}>
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
              <path d="M2 2h8v4M2 2v8h4M7 7l7 2.5-3 1 2 3-1.5 1-2-3-2 2z" />
            </svg>
            <span className="wb-dt-label">Select element</span>
          </button>
          {(tab === "elements" || tab === "sources") && (
            <button type="button" className="wb-dt-btn" aria-label={tab === "elements" ? "Refresh elements" : "Refresh sources"} onClick={refresh}>
              Refresh
            </button>
          )}
          {tab === "console" && (
            <button type="button" className="wb-dt-btn" aria-label="Clear console" onClick={onClearLogs}>
              Clear
            </button>
          )}
          {tab === "network" && (
            <button type="button" className="wb-dt-btn" aria-label="Clear network log" onClick={clearNetwork}>
              Clear
            </button>
          )}
          <button type="button" className="wb-dt-btn wb-dt-close" aria-label="Close developer tools" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
      <Panel id={`${uid}-panel-elements`} labelledBy={`${uid}-tab-elements`} active={tab === "elements"}>
        <ElementsPanel dom={dom} styles={styles} picked={picked} send={send} refreshSeq={refreshSeq} />
      </Panel>
      <Panel id={`${uid}-panel-console`} labelledBy={`${uid}-tab-console`} active={tab === "console"}>
        <ConsolePanel logs={logs} />
      </Panel>
      <Panel id={`${uid}-panel-sources`} labelledBy={`${uid}-tab-sources`} active={tab === "sources"}>
        <SourcesPanel sources={sources} sourceText={sourceText} send={send} />
      </Panel>
      <Panel id={`${uid}-panel-network`} labelledBy={`${uid}-tab-network`} active={tab === "network"}>
        <NetworkPanel network={network} clearedUpTo={clearedUpTo} />
      </Panel>
    </section>
  );
}

function Panel(props: { id: string; labelledBy: string; active: boolean; children: ReactElement }): ReactElement {
  return (
    <div id={props.id} role="tabpanel" aria-labelledby={props.labelledBy} className="wb-dt-panel" hidden={!props.active}>
      {props.children}
    </div>
  );
}

/* ---------- Console ---------- */

function ConsolePanel({ logs }: { logs: PreviewDevtoolsProps["logs"] }): ReactElement {
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    const list = listRef.current;
    if (list && atBottom.current) list.scrollTop = list.scrollHeight;
  }, [logs]);

  const onScroll = (): void => {
    const list = listRef.current;
    if (list) atBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
  };

  return (
    <div className="wb-dt-console" ref={listRef} onScroll={onScroll}>
      {logs.length === 0 ? (
        <p className="wb-dt-empty">Console is ready. Browser errors and console messages will appear here.</p>
      ) : (
        logs.map((log, index) => (
          <div key={index} className={`wb-dt-log wb-dt-log-${log.level}`}>
            <time>{log.time}</time>
            <code>{log.args.join(" ")}</code>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------- Sources ---------- */

function SourcesPanel(props: { sources: SourceEntry[]; sourceText: SourceText | null; send: Send }): ReactElement {
  const { sources, sourceText, send } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const shown = sourceText && sourceText.url === selected ? sourceText : null;
  const lines = shown?.text !== undefined ? shown.text.split("\n") : [];

  return (
    <div className="wb-dt-split">
      <ul className="wb-dt-pane wb-dt-src-list" aria-label="Source files">
        {sources.length === 0 && <li className="wb-dt-empty">No sources yet.</li>}
        {sources.map((entry) => (
          <li key={entry.url}>
            <button
              type="button"
              title={entry.url}
              aria-current={entry.url === selected}
              className={entry.url === selected ? "wb-dt-src-item is-on" : "wb-dt-src-item"}
              onClick={() => {
                setSelected(entry.url);
                send({ type: "source-request", url: entry.url });
              }}
            >
              <span className={`wb-dt-kind wb-dt-kind-${entry.kind}`}>{entry.kind}</span>
              {urlPath(entry.url)}
            </button>
          </li>
        ))}
      </ul>
      <div className="wb-dt-pane wb-dt-src-view">
        {selected === null && <p className="wb-dt-empty">Select a source file to view it.</p>}
        {selected !== null && !shown && <p className="wb-dt-empty">Loading…</p>}
        {shown?.error && <p className="wb-dt-empty wb-dt-error">{shown.error}</p>}
        {shown?.text !== undefined && (
          <div className="wb-dt-code">
            <pre className="wb-dt-gutter" aria-hidden="true">
              {lines.map((_, index) => index + 1).join("\n")}
            </pre>
            <pre className="wb-dt-text">{shown.text}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Network ---------- */

function NetworkPanel({ network, clearedUpTo }: { network: NetworkEntry[]; clearedUpTo: number }): ReactElement {
  const rows = visibleNetwork(network, clearedUpTo);
  if (rows.length === 0) return <p className="wb-dt-empty">No requests yet.</p>;
  return (
    <div className="wb-dt-scroll">
      <table className="wb-dt-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Method</th>
            <th scope="col">Status</th>
            <th scope="col">Type</th>
            <th scope="col">Time</th>
            <th scope="col">Size</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.id} className={isFailedRequest(entry) ? "is-failed" : undefined}>
              <td className="wb-dt-name" title={entry.url}>
                {urlName(entry.url)}
              </td>
              <td>{entry.method}</td>
              <td title={entry.error ?? entry.statusText}>{entry.error ? "failed" : (entry.status ?? "pending")}</td>
              <td>{entry.kind}</td>
              <td>{formatDuration(entry.durationMs)}</td>
              <td>{formatBytes(entry.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Elements ---------- */

type ElementsProps = {
  dom: PreviewDevtoolsProps["dom"];
  styles: NodeStyles | null;
  picked: PreviewDevtoolsProps["picked"];
  send: Send;
  refreshSeq: number;
};

function ElementsPanel({ dom, styles, picked, send, refreshSeq }: ElementsProps): ReactElement {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const [reveal, setReveal] = useState<number | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);
  const handledPick = useRef(0);
  const askedDomFor = useRef(0);
  const sendRef = useLatest(send);

  // Open the top levels the first time a tree arrives.
  useEffect(() => {
    if (!dom || seeded.current) return;
    seeded.current = true;
    setExpanded(defaultExpanded(dom.root));
  }, [dom]);

  // The tree was dropped (page reload): forget the selection and open the top levels of the next tree.
  useEffect(() => {
    if (dom) return;
    seeded.current = false;
    setSelectedId(null);
    setExpanded(new Set());
  }, [dom]);

  // Keep the selection across a new tree only when its node is still there.
  useEffect(() => {
    if (dom && selectedId !== null && !hasNode(dom.root, selectedId)) setSelectedId(null);
  }, [dom, selectedId]);

  // A click in inspect mode: select the node, open its ancestors, scroll to it.
  useEffect(() => {
    if (!picked || handledPick.current === picked.seq) return;
    if (!dom) return;
    const path = hasNode(dom.root, picked.nodeId) ? findPath(dom.root, picked.nodeId) : null;
    if (!path) {
      if (askedDomFor.current !== picked.seq) {
        askedDomFor.current = picked.seq;
        sendRef.current({ type: "dom-request" });
      }
      return;
    }
    handledPick.current = picked.seq;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of path.slice(0, -1)) next.add(id);
      return next;
    });
    setSelectedId(picked.nodeId);
    setReveal(picked.nodeId);
    sendRef.current({ type: "styles-request", nodeId: picked.nodeId });
  }, [picked, dom, sendRef]);

  useEffect(() => {
    if (reveal === null) return;
    treeRef.current?.querySelector(`[data-node-id="${reveal}"]`)?.scrollIntoView({ block: "nearest" });
    setReveal(null);
  }, [reveal]);

  // Ask for the tree again when the Refresh button is used.
  useEffect(() => {
    if (refreshSeq > 0 && selectedId !== null) sendRef.current({ type: "styles-request", nodeId: selectedId });
    // Only the refresh counter should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSeq]);

  // Clear the outline in the preview when the panel goes away.
  useEffect(() => {
    const latest = sendRef;
    return () => latest.current({ type: "highlight", nodeId: null });
  }, [sendRef]);

  const select = useCallback(
    (id: number): void => {
      setSelectedId(id);
      sendRef.current({ type: "styles-request", nodeId: id });
    },
    [sendRef],
  );

  const toggle = (id: number): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = dom ? visibleRows(dom.root, expanded) : [];
  // The one row in the Tab order: the selected row when it is visible, else the first visible row.
  const tabStopId = rows.some((row) => row.node.id === selectedId) ? selectedId : rows[0]?.node.id;

  const focusRow = (id: number): void => {
    treeRef.current?.querySelector<HTMLElement>(`[data-node-id="${id}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = rows.findIndex((row) => row.node.id === selectedId);
    const row = rows[current];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const target = rows[current === -1 ? 0 : current + (event.key === "ArrowDown" ? 1 : -1)];
      if (target) {
        select(target.node.id);
        focusRow(target.node.id);
      }
    } else if (row && event.key === "ArrowRight") {
      event.preventDefault();
      if (row.node.children.length > 0 && !expanded.has(row.node.id)) toggle(row.node.id);
      else if (row.node.children[0]) {
        select(row.node.children[0].id);
        focusRow(row.node.children[0].id);
      }
    } else if (row && event.key === "ArrowLeft") {
      event.preventDefault();
      if (expanded.has(row.node.id) && row.node.children.length > 0) toggle(row.node.id);
      else if (row.parentId !== null) {
        select(row.parentId);
        focusRow(row.parentId);
      }
    }
  };

  const hasStyles = styles !== null && styles.nodeId === selectedId;

  return (
    <div className="wb-dt-split wb-dt-elements">
      <div className="wb-dt-pane wb-dt-tree-pane">
        {!dom ? (
          <p className="wb-dt-empty">Loading the page…</p>
        ) : (
          <>
            <div
              className="wb-dt-tree"
              role="tree"
              aria-label="DOM tree"
              ref={treeRef}
              onKeyDown={onKeyDown}
              onMouseLeave={() => send({ type: "highlight", nodeId: null })}
            >
              {rows.map(({ node, depth }) => {
                const canOpen = node.children.length > 0;
                const open = expanded.has(node.id);
                const selected = node.id === selectedId;
                return (
                  <div
                    key={node.id}
                    role="treeitem"
                    aria-level={depth + 1}
                    aria-selected={selected}
                    aria-expanded={canOpen ? open : undefined}
                    data-node-id={node.id}
                    tabIndex={node.id === tabStopId ? 0 : -1}
                    className={selected ? "wb-dt-node is-selected" : "wb-dt-node"}
                    style={{ paddingLeft: 4 + depth * 12 }}
                    onMouseEnter={() => send({ type: "highlight", nodeId: node.id })}
                    onClick={() => select(node.id)}
                  >
                    {canOpen ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        className="wb-dt-caret"
                        aria-label={open ? "Collapse node" : "Expand node"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle(node.id);
                        }}
                      >
                        {open ? "▾" : "▸"}
                      </button>
                    ) : (
                      <span className="wb-dt-caret" aria-hidden="true" />
                    )}
                    <NodeLabel node={node} open={open} />
                  </div>
                );
              })}
            </div>
            {dom.truncated && <p className="wb-dt-note">Tree is truncated</p>}
          </>
        )}
      </div>
      <div className="wb-dt-pane wb-dt-styles-pane">
        {hasStyles ? <StylesPane styles={styles} send={send} /> : <p className="wb-dt-empty">Select an element to see its styles.</p>}
      </div>
    </div>
  );
}

function NodeLabel({ node, open }: { node: DomNode; open: boolean }): ReactElement {
  if (isTextNode(node)) return <span className="wb-dt-text-node">{node.text ?? ""}</span>;
  return (
    <span className="wb-dt-tag">
      {"<"}
      <span className="wb-dt-tagname">{node.tag}</span>
      {attrEntries(node).map(([name, value]) => (
        <span key={name}>
          {" "}
          <span className="wb-dt-attr">{name}</span>={'"'}
          <span className="wb-dt-attrval">{value}</span>
          {'"'}
        </span>
      ))}
      {">"}
      {node.children.length > 0 && !open && (
        <>
          …{"</"}
          <span className="wb-dt-tagname">{node.tag}</span>
          {">"}
        </>
      )}
    </span>
  );
}

/* ---------- Styles ---------- */

function StylesPane({ styles, send }: { styles: NodeStyles; send: Send }): ReactElement {
  const [view, setView] = useState<"styles" | "computed">("styles");
  const [filter, setFilter] = useState("");
  const commit = (property: string, value: string, important: boolean): void =>
    send({ type: "set-style", nodeId: styles.nodeId, property, value, important });

  return (
    <div className="wb-dt-styles">
      <div className="wb-dt-subtabs" role="tablist" aria-label="Style views">
        {(["styles", "computed"] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}>
            {id === "styles" ? "Styles" : "Computed"}
          </button>
        ))}
      </div>
      {view === "styles" ? (
        <div className="wb-dt-rules">
          <section className="wb-dt-rule">
            <h4>element.style</h4>
            {styles.inline.map((decl, index) => (
              <DeclRow
                key={`${decl.property}:${index}`}
                decl={decl}
                onEdit={(next) => {
                  if (next.property !== decl.property) commit(decl.property, "", false);
                  commit(next.property, next.value, next.important);
                }}
              />
            ))}
            <AddDecl onAdd={(decl) => commit(decl.property, decl.value, decl.important)} />
          </section>
          {styles.rules.map((rule, ruleIndex) => (
            <section className="wb-dt-rule" key={`${rule.selector}:${ruleIndex}`}>
              <h4>
                {rule.selector}
                {rule.source && <span className="wb-dt-source">{rule.source}</span>}
              </h4>
              {rule.declarations.map((decl, index) => (
                <DeclRow key={`${decl.property}:${index}`} decl={decl} onEdit={(next) => commit(next.property, next.value, next.important)} />
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="wb-dt-rules">
          <input className="wb-dt-filter" type="search" aria-label="Filter computed styles" placeholder="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
          {filterComputed(styles.computed, filter).map(([name, value]) => (
            <div className="wb-dt-decl" key={name}>
              <span className="wb-dt-prop">{name}</span>: <span className="wb-dt-val">{value}</span>;
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeclRow({ decl, onEdit }: { decl: StyleDeclaration; onEdit(next: StyleDeclaration): void }): ReactElement {
  return (
    <div className="wb-dt-decl">
      <Editable
        label={`property ${decl.property}`}
        value={decl.property}
        className="wb-dt-prop"
        onCommit={(property) => {
          const name = property.trim();
          if (name && name !== decl.property) onEdit({ property: name, value: decl.value, important: decl.important });
        }}
      />
      {": "}
      <Editable
        label={`value of ${decl.property}`}
        value={decl.value}
        suffix={decl.important ? " !important" : ""}
        className="wb-dt-val"
        onCommit={(value) => {
          if (value.trim() !== decl.value) onEdit({ property: decl.property, value: value.trim(), important: decl.important });
        }}
      />
      ;
    </div>
  );
}

function AddDecl({ onAdd }: { onAdd(decl: StyleDeclaration): void }): ReactElement {
  const [adding, setAdding] = useState(false);
  const cancelled = useRef(false);
  if (!adding) {
    return (
      <button type="button" className="wb-dt-add" aria-label="Add style property" onClick={() => setAdding(true)}>
        +
      </button>
    );
  }
  const finish = (text: string): void => {
    setAdding(false);
    if (cancelled.current) return;
    const parsed = parseDeclaration(text);
    if (parsed) onAdd(parsed);
  };
  return (
    <input
      className="wb-dt-edit"
      aria-label="New style declaration"
      placeholder="property: value"
      autoFocus
      onFocus={() => {
        cancelled.current = false;
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        else if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function Editable(props: { label: string; value: string; suffix?: string; className: string; onCommit(next: string): void }): ReactElement {
  const { label, value, suffix = "", className, onCommit } = props;
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  if (!editing) {
    return (
      <button
        type="button"
        className={`wb-dt-editable ${className}`}
        aria-label={`Edit ${label}`}
        onClick={() => {
          cancelled.current = false;
          setEditing(true);
        }}
      >
        {value}
        {suffix}
      </button>
    );
  }
  return (
    <input
      className={`wb-dt-edit ${className}`}
      aria-label={label}
      defaultValue={value}
      size={Math.max(4, value.length + 1)}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => {
        setEditing(false);
        if (!cancelled.current) onCommit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        else if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}
