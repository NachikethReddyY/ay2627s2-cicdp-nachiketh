
export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export type DomNode = {
  id: number;
  tag: string;
  attrs: Record<string, string>;
  text?: string;
  children: DomNode[];
};

export type StyleDeclaration = { property: string; value: string; important: boolean };

export type StyleRule = { selector: string; source: string; declarations: StyleDeclaration[] };

export type NodeStyles = {
  nodeId: number;
  inline: StyleDeclaration[];
  rules: StyleRule[];
  computed: Record<string, string>;
};

export type NetworkKind = "fetch" | "xhr" | "script" | "style" | "img" | "document" | "other";

export type NetworkEntry = {
  id: number;
  method: string;
  url: string;
  kind: NetworkKind;
  startedAt: number;
  status?: number;
  statusText?: string;
  durationMs?: number;
  size?: number;
  error?: string;
};

export type SourceEntry = { url: string; kind: "script" | "style" | "document" };

export type SourceText = { url: string; text?: string; error?: string };

export type PreviewToHost =
  | { type: "console"; level: LogLevel; args: string[] }
  | { type: "inspect-state"; enabled: boolean }
  | { type: "ready" }
  | { type: "element"; nodeId: number; tag: string; id: string; classes: string; text: string; size: string }
  | { type: "contextmenu"; x: number; y: number }
  | { type: "pointerdown" }
  | { type: "dom"; root: DomNode; truncated: boolean }
  | { type: "styles"; styles: NodeStyles }
  | { type: "network"; entry: NetworkEntry }
  | { type: "sources"; entries: SourceEntry[] }
  | ({ type: "source" } & SourceText);

export type HostToPreview =
  | { type: "inspect"; enabled: boolean }
  | { type: "dom-request" }
  | { type: "styles-request"; nodeId: number }
  | { type: "set-style"; nodeId: number; property: string; value: string; important?: boolean }
  | { type: "highlight"; nodeId: number | null }
  | { type: "sources-request" }
  | { type: "source-request"; url: string };
