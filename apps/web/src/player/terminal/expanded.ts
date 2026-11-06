/** Toggle a folder name in an immutable set of expanded folders. A Set (unlike a plain object) has no inherited keys such as `constructor` or `__proto__`. */
export function toggleExpanded(open: ReadonlySet<string>, name: string): Set<string> {
  const next = new Set(open);
  if (!next.delete(name)) next.add(name);
  return next;
}
