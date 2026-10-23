import type { ButtonHTMLAttributes, ReactNode } from "react";

const shapes = {
  robot: <><rect x="4" y="7" width="16" height="14" rx="3" /><path d="M12 3v4M1 12v5M23 12v5M8 17h8" /><circle cx="8" cy="12" r="1" /><circle cx="16" cy="12" r="1" /></>,
  filter: <path d="M3 4h18l-7 8v7l-4 2v-9Z" />,
  link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  folder: <><path d="M3 7V5h6l2 2h10v12H3Z" /><path d="M3 11h18" /></>,
  home: <><path d="m3 11 9-8 9 8M5 10v11h14V10M10 21v-6h4v6" /></>,
  save: <><path d="M4 3h13l3 3v15H4Z" /><path d="M8 3v6h8V3M8 21v-8h8v8" /></>,
  import: <><path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6" /></>,
  export: <><path d="M12 16V4m-4 4 4-4 4 4M4 15v6h16v-6" /></>,
  undo: <><path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12" /></>,
  play: <path d="m8 4 12 8-12 8Z" />,
  pause: <><path d="M7 4h3v16H7ZM15 4h3v16h-3Z" /></>,
  keyboard: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10" /></>,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
  layers: <><path d="m12 3 10 5-10 5L2 8ZM3 12l9 5 9-5M3 16l9 5 9-5" /></>,
  cube: <><path d="M12 2 21 7v10l-9 5-9-5V7Z" /><path d="m3 7 9 5 9-5M12 12v10" /></>,
  mirror: <><path d="M12 3v18M3 7l5-3v16l-5-3ZM21 7l-5-3v16l5-3Z" /></>,
  noFire: <><path d="M14 3c0 4-5 6-5 9 0 1 1 2 2 2M7 7c-2 3-3 5-3 8a8 8 0 0 0 13 6M17 7c2 3 3 5 3 8M3 3l18 18" /></>,
  skip: <><path d="m5 5 10 7-10 7ZM19 5v14" /></>,
  erase: <><path d="m4 14 9-11 9 7-9 11H8l-4-4ZM9 8l9 7M13 21h9" /></>,
  label: <><path d="M3 3h8l10 10-8 8L3 11Z" /><circle cx="7.5" cy="7.5" r="1" /></>,
  chart: <><path d="M3 3v18h18M6 15l4-5 4 3 6-8" /></>,
  left: <path d="m15 5-7 7 7 7" />,
  right: <path d="m9 5 7 7-7 7" />,
  reset: <><path d="M3 4v6h6M3 10a9 9 0 1 1 1 8" /></>,
  parallel: <path d="M7 5h15l-5 14H2Z" />,
  fire: <path d="M12 3c1 5-4 6-4 10 0 2 1 3 3 4-1-3 2-4 3-6 3 3 5 5 5 8a7 7 0 0 1-14 0c0-4 2-7 7-16Z" />,
  quad: <><path d="m5 5 15-2-2 17L3 18Z" /><path d="M3 3h4v4H3ZM18 1h4v4h-4ZM16 18h4v4h-4ZM1 16h4v4H1Z" /></>,
  ruler: <><path d="m3 16 13-13 5 5L8 21ZM7 12l3 3M10 9l2 2M13 6l3 3" /></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  zoomIn: <><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6M7 10h6M10 7v6" /></>,
  zoomOut: <><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6M7 10h6" /></>,
  fit: <><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /><rect x="7" y="7" width="10" height="10" rx="1" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  expand: <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />,
  actual: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 10v5M7 10.5l1-.5M16 10v5M15 10.5l1-.5M12 11h.01M12 14h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>,
  alert: <><path d="m12 3 10 18H2ZM12 9v5M12 17h.01" /></>,
  atlas: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>,
  enhance: <><path d="m4 20 10-10" /><path d="M16 3v5M13.5 5.5h5M19 11v3M17.5 12.5h3" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof shapes;
export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}

export function IconButton({ icon, label, children, className = "", title, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  const hasText = children !== undefined && children !== null && children !== false;
  return <button type="button" {...props} className={`icon-button ${hasText ? "with-text" : "icon-only"} ${className}`} aria-label={label} title={title ?? label}><Icon name={icon} />{children}</button>;
}
