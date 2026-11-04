import type { ReactNode } from "react";
import * as M from "@radix-ui/react-menubar";
import { authClient } from "../lib/auth";
import { FOCUS, MENU_ITEM, MENU_PANEL } from "./ui";
import { SPEEDS, type Speed } from "./useReplay";

type Props = {
  replay: boolean; // false: no replay (practice), so no Playback menu, file sidebar or replay help
  playing: boolean;
  speed: Speed;
  muted: boolean;
  explorer: boolean;
  desktop: boolean;
  full: boolean;
  canMinimize: boolean;
  windows: { id: string; label: string; open: boolean }[];
  on: {
    toggle(): void;
    step(d: 1 | -1): void;
    seekBy(ms: number): void;
    speed(s: Speed): void;
    mute(): void;
    sidebar(): void;
    full(): void;
    zoom(): void;
    minimize(): void;
    show(id: string): void;
    keys(): void;
    about(): void;
  };
};

const Hint = ({ children }: { children: ReactNode }) => (
  <span aria-hidden="true" className="ml-auto pl-6 text-xs font-bold text-ink/60">
    {children}
  </span>
);

function Item({ label, hint, keys, disabled, onSelect }: { label: string; hint?: string; keys?: string; disabled?: boolean; onSelect?(): void }) {
  return (
    <M.Item className={MENU_ITEM} aria-keyshortcuts={keys} disabled={disabled} onSelect={onSelect}>
      {label}
      {hint && <Hint>{hint}</Hint>}
    </M.Item>
  );
}

const Check = () => (
  <span aria-hidden="true" className="w-4 flex-none text-center">
    <M.ItemIndicator>✓</M.ItemIndicator>
  </span>
);

function Menu({ name, children }: { name: string; children: ReactNode }) {
  return (
    <M.Menu>
      <M.Trigger className={`min-h-6 rounded-md px-2 text-sm font-bold hover:bg-sun/60 data-[state=open]:bg-sun ${FOCUS}`}>{name}</M.Trigger>
      <M.Portal>
        <M.Content className={MENU_PANEL} align="start" sideOffset={6} loop>
          {children}
        </M.Content>
      </M.Portal>
    </M.Menu>
  );
}

const Sep = () => <M.Separator className="m-1 h-0.5 bg-ink/15" />;

function Account() {
  const { data } = authClient.useSession();
  return (
    <Menu name="Account">
      <Item label={data?.user.email ?? "Signed in"} disabled />
      <Sep />
      <Item
        label="Sign out"
        onSelect={async () => {
          try {
            const { error } = await authClient.signOut();
            if (error) throw error;
            location.assign("/");
          } catch {
            alert("Sign out failed. Check your connection and try again.");
          }
        }}
      />
    </Menu>
  );
}

export default function MenuBar(p: Props) {
  const { on } = p;
  return (
    <M.Root aria-label="Player menu" className="flex min-w-0 items-center gap-0.5 overflow-x-auto py-1">
      {p.replay && <Menu name="Playback">
        <Item label={p.playing ? "Pause" : "Play"} hint="Space" keys="Space" onSelect={on.toggle} />
        <Item label="Previous step" hint="Shift+←" keys="Shift+ArrowLeft" onSelect={() => on.step(-1)} />
        <Item label="Next step" hint="Shift+→" keys="Shift+ArrowRight" onSelect={() => on.step(1)} />
        <Item label="Back 5 seconds" hint="←" keys="ArrowLeft" onSelect={() => on.seekBy(-5000)} />
        <Item label="Forward 5 seconds" hint="→" keys="ArrowRight" onSelect={() => on.seekBy(5000)} />
        <Sep />
        <M.Sub>
          <M.SubTrigger className={MENU_ITEM} aria-keyshortcuts="Comma Period">
            Speed
            <Hint>
              , / . <span className="ml-2">›</span>
            </Hint>
          </M.SubTrigger>
          <M.Portal>
            <M.SubContent className={MENU_PANEL} sideOffset={4} alignOffset={-8} loop>
              <M.RadioGroup value={String(p.speed)} onValueChange={(v) => on.speed(SPEEDS.find((s) => String(s) === v) ?? 1)}>
                {SPEEDS.map((s) => (
                  <M.RadioItem key={s} value={String(s)} className={MENU_ITEM}>
                    <Check />
                    {s === "instant" ? "Instant" : `${s}×`}
                  </M.RadioItem>
                ))}
              </M.RadioGroup>
            </M.SubContent>
          </M.Portal>
        </M.Sub>
        <Item label={p.muted ? "Unmute" : "Mute"} hint="M" keys="M" onSelect={on.mute} />
      </Menu>}

      {(p.replay || p.desktop) && <Menu name="View">
        {p.replay && <Item label={p.explorer ? "Hide file sidebar" : "Show file sidebar"} hint="B" keys="B" onSelect={on.sidebar} />}
        {p.desktop && (
          <>
            <Item label={p.full ? "Exit full screen" : "Enter full screen"} hint="F" keys="F" onSelect={on.full} />
            <Item label="Zoom window" disabled={p.full} onSelect={on.zoom} />
          </>
        )}
      </Menu>}

      {p.desktop && (
        <Menu name="Window">
          <Item label="Minimize" disabled={!p.canMinimize || p.full} onSelect={on.minimize} />
          <Sep />
          {p.windows.map((w) => (
            <M.CheckboxItem key={w.id} checked={w.open} onCheckedChange={() => on.show(w.id)} className={MENU_ITEM}>
              <Check />
              {w.label}
            </M.CheckboxItem>
          ))}
        </Menu>
      )}

      <Account />

      {p.replay && <Menu name="Help">
        <Item label="Keyboard shortcuts" hint="?" keys="Shift+Slash" onSelect={on.keys} />
        <Item label="About this replay" onSelect={on.about} />
      </Menu>}
    </M.Root>
  );
}
