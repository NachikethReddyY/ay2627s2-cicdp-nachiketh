import { useSyncExternalStore } from "react";

function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-resolved"] });
  return () => observer.disconnect();
}

function readResolvedTheme() {
  return document.querySelector(".wb")?.getAttribute("data-resolved") === "dark" ? "dark" : "light";
}

function ThemedAppIcon({ light, dark }: { light: string; dark: string }) {
  const theme = useSyncExternalStore(subscribeToTheme, readResolvedTheme, () => "light");
  return <img src={theme === "dark" ? dark : light} alt="" className="block size-full" draggable={false} />;
}

export function EditorAppIcon() {
  return <ThemedAppIcon light="/img/dock-editor.png" dark="/img/dock-editor-dark.png" />;
}

export function BrowserAppIcon() {
  return <ThemedAppIcon light="/img/dock-browser.png" dark="/img/dock-browser-dark.png" />;
}

export function NotepadAppIcon() {
  return <ThemedAppIcon light="/img/dock-notepad.png" dark="/img/dock-notepad-dark.png" />;
}
