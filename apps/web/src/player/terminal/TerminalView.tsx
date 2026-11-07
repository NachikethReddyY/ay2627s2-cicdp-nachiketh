import { useCallback, useEffect, useRef, useState } from "react";
import { GhosttyCore } from "@wterm/ghostty";
import { Terminal, useTerminal } from "@wterm/react";
import type { TerminalThemeColors } from "@wterm/dom";
import "@wterm/react/css";
import type { ShellSocket } from "./shellSocket";

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

// Wterm renders the terminal in the DOM and Ghostty supplies full VT emulation.
// The existing shell socket continues to carry input, output, and PTY resize events.
export default function TerminalView({ shell, active = true, fitKey }: TerminalViewProps) {
  const { ref, write, focus } = useTerminal();
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [coreError, setCoreError] = useState(false);
  const activeRef = useRef(active);
  const connectedRef = useRef(false);
  const terminalRef = useRef<import("@wterm/dom").WTerm | null>(null);
  activeRef.current = active;

  const applyWorkbenchTheme = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const workbench = terminal.element.closest<HTMLElement>(".wb");
    if (!workbench) return;
    const dark = workbench.dataset.resolved === "dark";
    terminal.setThemeColors(dark ? DARK_COLORS : LIGHT_COLORS);
  }, []);

  const onResize = useCallback((cols: number, rows: number) => {
    if (!connectedRef.current) {
      connectedRef.current = true;
      shell.connect(cols, rows);
      return;
    }
    shell.resize(cols, rows);
  }, [shell]);

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
    const workbench = ref.current?.instance?.element.closest<HTMLElement>(".wb");
    if (!workbench) return;
    const observer = new MutationObserver(applyWorkbenchTheme);
    observer.observe(workbench, { attributes: true, attributeFilter: ["data-resolved"] });
    applyWorkbenchTheme();
    return () => observer.disconnect();
  }, [applyWorkbenchTheme, core, ref]);

  useEffect(() => {
    let live = true;
    let loaded: GhosttyCore | null = null;
    void GhosttyCore.load({ backgroundColor: "#ffffff", foregroundColor: "#1c1c1e" }).then((next) => {
      loaded = next;
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

  if (coreError) return <p role="status" className="p-3 text-xs text-white/75">Could not start the terminal emulator.</p>;
  if (!core) return <p role="status" className="p-3 text-xs text-white/75">Preparing terminal…</p>;

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
      onBinary={(data) => { shell.send(new TextDecoder().decode(data)); }}
      onResize={onResize}
      onReady={(terminal) => {
        terminalRef.current = terminal;
        applyWorkbenchTheme();
        if (activeRef.current) focus();
      }}
    />
  );
}
