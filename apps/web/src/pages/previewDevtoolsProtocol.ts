// Messages between the preview bridge and the devtools panel.
//
// The bridge is a script injected into the preview's HTML (PREVIEW_BRIDGE in webContainerPreview.ts). It runs
// inside the preview iframe, which is a different origin, so the two sides only talk through postMessage.
//   - bridge -> host:  every message carries `__learnquestPreview: true`, and its type is one of PreviewToHost.
//   - host -> bridge:  every command carries `__learnquestPreviewCommand: true`, and its type is one of HostToPreview.
// Node ids are assigned by the bridge, one per element, the first time that element is sent. An id stays
// the same for as long as the element lives, so a stale id simply names no node any more.

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

/** One node of the preview's DOM. Text nodes use tag "#text" and carry their text in `text`. */
export type DomNode = {
  id: number;
  tag: string;
  attrs: Record<string, string>;
  text?: string;
  children: DomNode[];
};

export type StyleDeclaration = { property: string; value: string; important: boolean };

/** A CSS rule that matches the node. `source` names the stylesheet or <style> it came from, when known. */
export type StyleRule = { selector: string; source: string; declarations: StyleDeclaration[] };

export type NodeStyles = {
  nodeId: number;
  /** The element's own style attribute. */
  inline: StyleDeclaration[];
  /** Matching rules, in cascade order (lowest priority first). */
  rules: StyleRule[];
  /** Computed value for every property the browser reports. */
  computed: Record<string, string>;
};

export type NetworkKind = "fetch" | "xhr" | "script" | "style" | "img" | "document" | "other";

/** One request. The bridge sends it once when the request starts and again, with the same id, when it finishes. */
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

/** Bridge -> host messages. */
export type PreviewToHost =
  | { type: "console"; level: LogLevel; args: string[] }
  | { type: "inspect-state"; enabled: boolean }
  /** The bridge has installed. Sent once per page load, so the host can drop state from the previous page. */
  | { type: "ready" }
  /** A click in inspect mode. `nodeId` names the picked element in the latest `dom` tree. */
  | { type: "element"; nodeId: number; tag: string; id: string; classes: string; text: string; size: string }
  | { type: "contextmenu"; x: number; y: number }
  | { type: "pointerdown" }
  | { type: "dom"; root: DomNode; truncated: boolean }
  | { type: "styles"; styles: NodeStyles }
  | { type: "network"; entry: NetworkEntry }
  | { type: "sources"; entries: SourceEntry[] }
  | ({ type: "source" } & SourceText);

/** Host -> bridge commands. */
export type HostToPreview =
  | { type: "inspect"; enabled: boolean }
  | { type: "dom-request" }
  | { type: "styles-request"; nodeId: number }
  /** Sets (or, with an empty value, removes) one inline style. The bridge answers with a `styles` message. */
  | { type: "set-style"; nodeId: number; property: string; value: string; important?: boolean }
  /** Outlines the node in the preview while the panel hovers it. `null` clears the outline. */
  | { type: "highlight"; nodeId: number | null }
  | { type: "sources-request" }
  | { type: "source-request"; url: string };
