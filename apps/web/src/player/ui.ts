/** Keyboard-only focus ring shared by every player control (nothing on mouse focus): 2px accent, 2px outside the control. */
export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue";

/** Glass menu panel: 1px hairline, 12px radius, frosted, one soft lift shadow and no offset. */
export const MENU_PANEL =
  "z-[4000] min-w-56 rounded-xl border border-[var(--glass-line)] bg-[var(--glass)] p-1 shadow-[var(--lift)] backdrop-blur-xl";

/** Quiet menu row: hover tints it, and the selected or open row takes the selection tint. Focus uses the global ring. */
export const MENU_ITEM =
  "flex min-h-7 cursor-default items-center gap-2 rounded-lg px-2 text-sm font-medium select-none data-[disabled]:opacity-40 data-[highlighted]:bg-[var(--hov)] data-[state=checked]:bg-[var(--sel)] data-[state=open]:bg-[var(--sel)]";
