import { useMemo, useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import type { GameProps } from "@learnquest/ui-catalog";
import { setupFor, type DragKind, type Item, type Placed, type Zone } from "./dragSetup.ts";
import Shell, { btn } from "./Shell.tsx";
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
      className={`${btn} max-w-full break-words text-left text-sm ${selected ? "bg-sun" : ""} ${isDragging ? "opacity-60" : ""}`}
    >
      {item.label}
    </button>
  );
}

function Box({ zone, occupant, over, onTap, children }: { zone: Zone; occupant: string; over: boolean; onTap: () => void; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: zone.id });
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={`${zone.label}${occupant ? `, holds ${occupant}` : ", empty"}`}
      onClick={onTap}
      className={`flex min-h-11 min-w-0 flex-wrap items-center gap-2 rounded-2xl border-2 border-dashed border-ink p-2 ${over ? "bg-sun" : "bg-paper"}`}
    >
      <span className="text-xs font-extrabold">{zone.label}</span>
      {children}
    </div>
  );
}

function DragBoard({ p, kind, onComplete }: { p: GameProps; kind: DragKind; onComplete?: () => void }) {
  const setup = useMemo(() => setupFor(kind), [kind]);
  const maxLives = p.shell.lives;
  const [placed, setPlaced] = useState<Placed>(setup.start);
  const [selected, setSelected] = useState<string | null>(null);
  const [lives, setLives] = useState(maxLives);
  const [outcome, setOutcome] = useState<Outcome>("play");
  const [live, setLive] = useState("");
  const over = outcome === "win" || outcome === "lose";
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const [hot, setHot] = useState<string | null>(null);

  const zoneName = (z: string | null) => setup.zones.find((x) => x.id === z)?.label ?? "the pool";
  const labelOf = (id: string) => setup.items.find((x) => x.id === id)!.label;

  // Dropping an item on a full box swaps the occupant back to where the dragged item came from.
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

  const check = () => {
    if (over) return;
    const unplaced = setup.items.filter((i) => !placed[i.id]).length;
    if (unplaced) return setLive(`${unplaced} ${unplaced === 1 ? "item is" : "items are"} still in the pool. Place everything, then check.`);
    const wrong = setup.items.filter((i) => !setup.isRight(i.id, placed[i.id]!)).length;
    if (wrong === 0) return (setOutcome("win"), setLive("You win! Everything is in the right place."));
    const left = lives === undefined ? undefined : lives - 1;
    if (left !== undefined) setLives(left);
    if (left !== undefined && left <= 0) return (setOutcome("lose"), setLive(`Game over, no lives left. ${wrong} ${wrong === 1 ? "item is" : "items are"} in the wrong place.`));
    setLive(`Not yet: ${wrong} ${wrong === 1 ? "item is" : "items are"} in the wrong place. Move them and check again.`);
  };

  const retry = () => {
    setPlaced(setup.start), setSelected(null), setOutcome("play"), setLive("Back at the start.");
    setLives(maxLives);
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
    <Shell {...p} lives={lives} maxLives={maxLives} outcome={outcome} live={live} onRetry={retry} onComplete={onComplete}>
      <DndContext sensors={sensors} onDragEnd={onDragEnd} onDragOver={(e) => setHot(e.over ? String(e.over.id) : null)} onDragCancel={() => setHot(null)}>
        <div role="group" aria-label={`${setup.title} game`} className="flex min-w-0 flex-col gap-3">
          {pool.length > 0 && (
            <div role="group" aria-label="Pool" className="flex min-w-0 flex-wrap gap-2 rounded-2xl border-2 border-ink p-2">
              <span className="w-full text-xs font-extrabold">Pool</span>
              {pool.map(itemButton)}
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
          <p className="text-xs">Drag an item into a box, or tap an item and then tap a box. Keyboard: Tab to an item, press Space to pick it up, arrows to move, Space to drop.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${btn} bg-green`} disabled={over} onClick={check}>Check</button>
          </div>
        </div>
      </DndContext>
    </Shell>
  );
}

export default function DragGame({ p, kind, onComplete }: { p: GameProps; kind: DragKind; onComplete?: () => void }) {
  return <DragBoard p={p} kind={kind} onComplete={onComplete} />;
}
