const SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;

export function canExpand(parent: string, name: string): boolean {
  const parts = (parent ? parent.split("/") : []).concat(name);
  return parts.length <= 4 && parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..");
}
