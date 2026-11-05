// Mascot and icon art, copied from the design.
export function Flame({ w, h, cls = "", fill = "#FF6A1F", inner = "#FFD23F", stroke = 2.5 }: { w: number; h: number; cls?: string; fill?: string; inner?: string; stroke?: number }) {
  return (
    <svg className={cls} width={w} height={h} viewBox="0 0 32 40" aria-hidden="true">
      <path d="M16 2c1 8 11 12 11 23a11 11 0 0 1-22 0c0-6 3-10 6-13 0 4 2 7 5 7-2-6-1-12 0-17z" fill={fill} stroke="#15121F" strokeWidth={stroke} strokeLinejoin="round" />
      <path d="M16 21c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-6 4-7 0 2 1 3 2 3z" fill={inner} />
    </svg>
  );
}

export function Bolt({ w, h }: { w: number; h: number }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 28" aria-hidden="true">
      <path d="M14 1 3 16h8l-2 11 12-16h-8z" fill="#FFD23F" stroke="#15121F" strokeWidth={2.5} strokeLinejoin="round" />
    </svg>
  );
}

// Pip, the real mascot art from public/img. The pose tracks the generator state.
export function Pip({ src, size }: { src: string; size: number }) {
  return <img className="lq-pip" src={src} width={size} height={size} alt="" aria-hidden="true" style={{ objectFit: "contain" }} />;
}

export function Arrow() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Check({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
