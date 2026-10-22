/** Splosh's "[splosh]" mark, shown on the JoltCracker button as a tribute to JoltCracker's author. */
export function SploshMark({ size = 18 }: { size?: number }) {
  return <svg className="splosh-mark" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Splosh">
    <rect width="64" height="64" rx="10" fill="#082419" />
    <text x="32" y="38" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontStyle="italic" fontSize="15" fill="#2fc464">[splosh]</text>
  </svg>;
}
