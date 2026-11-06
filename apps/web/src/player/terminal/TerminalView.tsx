import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { ShellSocket } from "./shellSocket";
import { isToggleKey } from "./usePanel";

type TerminalViewProps = { shell: ShellSocket; active?: boolean };

// Mounts xterm onto the shared shell socket. Unmounting disposes xterm only; the socket outlives the view.
export default function TerminalView({ shell, active = true }: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: { background: "#1b1b1f", foreground: "#ffffff" },
    });
    termRef.current = term;
    if (activeRef.current) term.focus();
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    // Ctrl+` toggles the panel; keep it from reaching the shell as NUL.
    term.attachCustomKeyEventHandler((e) => !isToggleKey(e));
    const data = term.onData((d) => shell.send(d));
    const off = shell.onOutput((b) => term.write(b));
    shell.connect(term.cols, term.rows);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // A hidden panel measures 0x0; fitting then would resize the shell to nothing.
        if (!el.clientWidth || !el.clientHeight) return;
        fit.fit();
        shell.resize(term.cols, term.rows);
      }, 100);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
      off();
      data.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [shell]);

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  return <div ref={host} aria-label="Terminal" className="h-full w-full overflow-hidden bg-[#1b1b1f] p-1" />;
}
