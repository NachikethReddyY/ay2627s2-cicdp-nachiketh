import { useCallback, useEffect, useRef, useState } from "react";
import { GhosttyCore } from "@wterm/ghostty";
import { Terminal, useTerminal } from "@wterm/react";
import type { TerminalThemeColors } from "@wterm/dom";
import "@wterm/react/css";
import type { ShellSocket } from "./shellSocket";
import { isToggleKey } from "./usePanel";

type TerminalViewProps = { shell: ShellSocket; active?: boolean; fitKey?: string | number };

const LIGHT_COLORS: TerminalThemeColors = {
  foreground: 0x1c1c1e,
  background: 0xffffff,
  cursor: 0x2f5fd6,
  palette: [0x1c1c1e, 0xc2362f, 0x1f9d55, 0xb7791f, 0x2f5fd6, 0x9b3fa8, 0x087f8c, 0xe8e8e8, 0x555a66, 0xc2362f, 0x168447, 0x98630f, 0x2451b7, 0x873393, 0x066b75, 0xffffff],
};

const DARK_COLORS: TerminalThemeColors = {
  foreground: 0xececec,
  background: 0x262626,
  cursor: 0x8fb0ff,
  palette: [0xececec, 0xff6b61, 0x3fc07a, 0xe0a84a, 0x8fb0ff, 0xcba6f7, 0x78c2ff, 0x3a3a3a, 0x9a9a9a, 0xff6b61, 0x3fc07a, 0xe0a84a, 0x8fb0ff, 0xcba6f7, 0x78c2ff, 0xffffff],
};

const parseColor = (value: string): number | null => {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) return Number.parseInt(hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1], 16);
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v);
  return rgb ? (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]) : null;
};

const luma = (c: number) => (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;

const colorScheme = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined);

function rootTheme(): TerminalThemeColors {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => parseColor(css.getPropertyValue(name));
  const dark = colorScheme()?.matches ?? false;
  const background = token("--code") ?? (dark ? DARK_COLORS : LIGHT_COLORS).background;
  const base = luma(background) < 0.5 ? DARK_COLORS : LIGHT_COLORS;
  const cursor = token(base === DARK_COLORS ? "--acT" : "--ac") ?? base.cursor;
  return { foreground: token("--tx") ?? base.foreground, background, cursor, palette: base.palette };
}

const ROOT_TERM_VARS = {
  "--term-app-bg": "var(--code)",
  "--term-app-fg": "var(--tx)",
  "--term-app-cursor": "var(--acT)",
  "--term-selection-bg": "var(--sel)",
};

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

export default function TerminalView({ shell, active = true, fitKey }: TerminalViewProps) {
  const { ref, write, focus } = useTerminal();
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [coreError, setCoreError] = useState(false);
  const activeRef = useRef(active);
  const connectedRef = useRef(false);
  const terminalRef = useRef<import("@wterm/dom").WTerm | null>(null);
  const priorFocusRef = useRef<Element | null>(null);
  activeRef.current = active;

  const applyWorkbenchTheme = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const workbench = terminal.element.closest<HTMLElement>(".wb");
    if (!workbench) {
      for (const [name, value] of Object.entries(ROOT_TERM_VARS)) terminal.element.style.setProperty(name, value);
      terminal.setThemeColors(rootTheme());
      return;
    }
    const dark = workbench.dataset.resolved === "dark";
    terminal.setThemeColors(dark ? DARK_COLORS : LIGHT_COLORS);
  }, []);

  const connectOnce = useCallback((cols: number, rows: number) => {
    if (connectedRef.current) return false;
    connectedRef.current = true;
    if (shell.state().kind === "open" || shell.state().kind === "connecting") shell.resize(cols, rows);
    else shell.connect(cols, rows);
    return true;
  }, [shell]);

  const onResize = useCallback((cols: number, rows: number) => {
    if (connectOnce(cols, rows)) return;
    shell.resize(cols, rows);
  }, [connectOnce, shell]);

  useEffect(() => {
    shell.setActive(active);
    if (active) focus();
  }, [shell, active, focus]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => terminalRef.current?.fit());
    return () => cancelAnimationFrame(frame);
  }, [active, fitKey]);

  useEffect(() => shell.onOutput(write), [shell, write]);

  useEffect(() => {
    const element = ref.current?.instance?.element;
    if (!element) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleKey(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    element.addEventListener("keydown", onKey, true);
    return () => element.removeEventListener("keydown", onKey, true);
  }, [core, ref]);

  useEffect(() => {
    const workbench = ref.current?.instance?.element.closest<HTMLElement>(".wb");
    if (!workbench) {
      const scheme = colorScheme();
      scheme?.addEventListener("change", applyWorkbenchTheme);
      applyWorkbenchTheme();
      return () => scheme?.removeEventListener("change", applyWorkbenchTheme);
    }
    const observer = new MutationObserver(applyWorkbenchTheme);
    observer.observe(workbench, { attributes: true, attributeFilter: ["data-resolved"] });
    applyWorkbenchTheme();
    return () => observer.disconnect();
  }, [applyWorkbenchTheme, core, ref]);

  useEffect(() => {
    let live = true;
    let loaded: GhosttyCore | null = null;
    void GhosttyCore.load({ backgroundColor: hex(rootTheme().background), foregroundColor: hex(rootTheme().foreground) }).then((next) => {
      loaded = next;
      priorFocusRef.current = document.activeElement;
      if (live) setCore(next);
      else next.dispose();
    }).catch(() => {
      if (live) setCoreError(true);
    });
    return () => {
      live = false;
      loaded?.dispose();
    };
  }, []);

  if (coreError) return <p role="status" className="p-3 text-xs text-ink/75">Could not start the terminal emulator.</p>;
  if (!core) return <p role="status" className="p-3 text-xs text-ink/75">Preparing terminal…</p>;

  return (
    <Terminal
      ref={ref}
      aria-label="Terminal"
      className="wb-terminal"
      core={core}
      autoResize
      cursorBlink
      renderingPaused={!active}
      onData={(data) => { shell.send(data); }}
      onBinary={(data) => { shell.sendBytes(data); }}
      onResize={onResize}
      onReady={(terminal) => {
        terminalRef.current = terminal;
        connectOnce(terminal.cols, terminal.rows);
        applyWorkbenchTheme();
        if (activeRef.current) {
          focus();
        } else {
          terminal.element.querySelector("textarea")?.blur();
          const prior = priorFocusRef.current;
          if (prior?.isConnected && prior !== document.body) (prior as HTMLElement).focus?.();
        }
      }}
    />
  );
}
