import { useMemo, useRef, useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Check, GripVertical, Plus } from "lucide-react";
import type { PublicGameProps } from "@learnquest/ui-catalog";
import type { ActiveGameApi } from "./api.ts";
import { setupFor, type DragKind, type Item, type Placed, type Zone } from "./dragSetup.ts";
import Shell, { btnPrimary } from "./Shell.tsx";
import type { Outcome } from "./model.ts";

function ItemButton({ item, selected, disabled, onTap }: { item: Item; selected: boolean; disabled: boolean; onTap: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id, disabled });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-pressed={selected}
      aria-label={`${item.label}${selected ? ", selected. Tap a box to place it." : ""}`}
      onClick={onTap}
      disabled={disabled}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, touchAction: "none" }}
      className={`relative flex min-h-11 max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium shadow-[var(--lift-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ac)] disabled:opacity-60 ${selected ? "border-[var(--ac)] bg-[var(--sel)] text-[var(--acT)]" : "border-[var(--line)] bg-[var(--panel)] text-[var(--tx)] enabled:hover:border-[var(--ac)]"} ${isDragging ? "z-20 cursor-grabbing opacity-80" : "z-10 enabled:cursor-grab"}`}
    >
      {selected ? <Check size={16} className="shrink-0" aria-hidden="true" /> : <GripVertical size={16} className="shrink-0 text-[var(--mu)]" aria-hidden="true" />}
      <span className="min-w-0 [overflow-wrap:anywhere]">{item.label}</span>
    </button>
  );
}

function Box({ zone, occupant, over, onTap, children }: { zone: Zone; occupant: string; over: boolean; onTap: () => void; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: zone.id });
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={zone.label}
      className={`relative grid min-w-0 gap-2 rounded-xl border p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:items-center ${over ? "border-[var(--ac)] bg-[var(--sel)]" : "border-[var(--line)] bg-[var(--glass)]"}`}
    >
      <button
        type="button"
        aria-label={`${zone.label}${occupant ? `, holds ${occupant}` : ", empty"}. Select an item, then activate to place it here.`}
        onClick={onTap}
        className="absolute inset-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ac)]"
      />
      <span aria-hidden="true" className="pointer-events-none px-1 text-sm font-semibold [overflow-wrap:anywhere]">{zone.label}</span>
      <div className={`flex min-h-12 min-w-0 flex-wrap items-center gap-2 rounded-lg ${occupant ? "" : "pointer-events-none border border-dashed border-[var(--mu)] bg-[var(--code)] px-3"}`}>
        {occupant ? children : <span aria-hidden="true" className="flex items-center gap-2 text-sm text-[var(--mu)]"><Plus size={16} /> Drop here</span>}
      </div>
    </div>
  );
}

function DragBoard({ p, kind, api }: { p: PublicGameProps; kind: DragKind; api: ActiveGameApi }) {
  const setup = useMemo(() => setupFor(kind), [kind]);
  const maxLives = api.maxAttempts;
  const [placed, setPlaced] = useState<Placed>(setup.start);
  const [selected, setSelected] = useState<string | null>(null);
  const [lives, setLives] = useState(api.remainingAttempts);
  const [outcome, setOutcome] = useState<Outcome>(api.remainingAttempts > 0 ? "play" : "lose");
  const [live, setLive] = useState("");
  const over = outcome === "win" || outcome === "lose";
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const [hot, setHot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gen = useRef(0);

  const zoneName = (z: string | null) => setup.zones.find((x) => x.id === z)?.label ?? "the pool";
  const labelOf = (id: string) => setup.items.find((x) => x.id === id)!.label;

  const place = (item: string, zone: string) => {
    if (over) return;
    const from = placed[item] ?? null;
    if (from === zone) return;
    const next = { ...placed };
    if (setup.capacity === 1) {
      const occupant = Object.keys(placed).find((k) => placed[k] === zone && k !== item);
      if (occupant) next[occupant] = from;
    }
    next[item] = zone;
    setPlaced(next);
    setSelected(null);
    setLive(`Placed ${labelOf(item)} in ${zoneName(zone)}.`);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setHot(null);
    if (e.over) place(String(e.active.id), String(e.over.id));
  };

  const check = async () => {
    if (over || busy) return;
    const unplaced = setup.items.filter((i) => !placed[i.id]).length;
    if (unplaced) return setLive(`${unplaced} ${unplaced === 1 ? "item is" : "items are"} still in the pool. Place everything, then check.`);
    setBusy(true);
    const mine = gen.current;
    try {
      const r = await api.check(setup.submit(placed));
      if (mine !== gen.current) return;
      setLives(r.remainingAttempts);
      if (r.correct) return (setOutcome("win"), setLive("You win! Everything is in the right place."));
      if (r.remainingAttempts === 0) return (setOutcome("lose"), setLive("Some items are in the wrong place."));
      setLive("Not yet: some items are in the wrong place. Move them and check again.");
    } catch {
      if (mine === gen.current) setLive("Couldn't check your answer. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    gen.current++;
    setPlaced(setup.start), setSelected(null), setOutcome("play"), setLive("Back at the start.");
  };

  const tapZone = (zone: string) => {
    if (selected) place(selected, zone);
  };

  const inZone = (zone: string) => setup.items.filter((i) => placed[i.id] === zone);
  const pool = setup.items.filter((i) => !placed[i.id]);

  const itemButton = (i: Item) => (
    <ItemButton key={i.id} item={i} selected={selected === i.id} disabled={over} onTap={() => setSelected(selected === i.id ? null : i.id)} />
  );

  return (
    <Shell {...p} onHint={api.hint} lives={lives} maxLives={maxLives} outcome={outcome} live={live} onRetry={retry} busy={busy}>
      <DndContext sensors={sensors} onDragEnd={onDragEnd} onDragOver={(e) => setHot(e.over ? String(e.over.id) : null)} onDragCancel={() => setHot(null)}>
        <div role="group" aria-label={`${setup.title} game`} className="flex min-w-0 flex-col gap-4">
          <p className="text-sm text-[var(--mu)]">Drag an item into a box, or select an item and then select a box. With the keyboard, focus an item, press Space to pick it up, use the arrows to move, and press Space to drop.</p>
          {pool.length > 0 && (
            <div role="group" aria-label="Pool" className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--code)] p-3">
              <p className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-semibold">
                Pool <span className="text-xs font-medium text-[var(--mu)]">{pool.length} left to place</span>
              </p>
              <div className="flex flex-wrap gap-2">{pool.map(itemButton)}</div>
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-2">
            {setup.zones.map((z) => {
              const items = inZone(z.id);
              return (
                <Box key={z.id} zone={z} occupant={items.map((i) => i.label).join(", ")} over={hot === z.id} onTap={() => tapZone(z.id)}>
                  {items.map(itemButton)}
                </Box>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={over || busy} onClick={check}>Check</button>
          </div>
        </div>
      </DndContext>
    </Shell>
  );
}

export default function DragGame({ p, kind, api }: { p: PublicGameProps; kind: DragKind; api: ActiveGameApi }) {
  return <DragBoard p={p} kind={kind} api={api} />;
}
