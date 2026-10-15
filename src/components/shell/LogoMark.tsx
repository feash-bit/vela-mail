import { useId } from "react";

/** The Vela mark: a star dropping into an envelope "V". Follows the accent colour. */
export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="96 96 832 832" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="160" y1="96" x2="880" y2="944" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "color-mix(in oklab, var(--accent) 72%, white)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--accent)" }} />
          <stop offset="1" style={{ stopColor: "var(--accent-2)" }} />
        </linearGradient>
      </defs>
      <rect x="96" y="96" width="832" height="832" rx="208" fill={`url(#${id})`} />
      <path d="M262 424 L512 690 L762 424" fill="none" stroke="#fff" strokeWidth="80" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M512 222 C522 290 544 312 612 322 C544 332 522 354 512 422 C502 354 480 332 412 322 C480 312 502 290 512 222 Z" fill="#fff" />
    </svg>
  );
}
