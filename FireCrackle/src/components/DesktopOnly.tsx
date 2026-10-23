/** The one note for a feature that needs the desktop backend (the browser preview has none). */
export function DesktopOnly({ what, available }: { what: string; available: boolean }) {
  if (available) return null;
  return <p className="dim desktop-only">{what} is available in the desktop app.</p>;
}
