export function toggleExpanded(open: ReadonlySet<string>, name: string): Set<string> {
  const next = new Set(open);
  if (!next.delete(name)) next.add(name);
  return next;
}
