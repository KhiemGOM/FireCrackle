import { useEffect, useId, useMemo, useState } from "react";
import fire1 from "../assets/fire_1.png";
import { hudTexels } from "../lib/hudOverlay";
import "./HudOverlay.css";
import { FireTexels } from "./FireTexels";

interface Props {
  width: number;
  height: number;
  row: number;
  fov: number;
  opacity: number;
  pixelGrid: boolean;
}

/** A visual reference only: no detector decisions and no label writes. */
export function HudOverlay({ width, height, row, fov, opacity, pixelGrid }: Props) {
  const clipId = useId();
  const [rgba, setRgba] = useState<Uint8ClampedArray | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      try {
        if (image.naturalWidth !== 16 || image.naturalHeight !== 512) throw new Error("Invalid sprite sheet");
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 512;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.drawImage(image, 0, 0);
        setRgba(ctx.getImageData(0, 0, 16, 512).data);
      } catch { setError(true); }
    };
    image.onerror = () => { if (!cancelled) setError(true); };
    image.src = fire1;
    return () => { cancelled = true; };
  }, []);
  const texels = useMemo(() => rgba && width > 0 && height > 0 ? hudTexels(rgba, row, width, height, fov) : [], [rgba, row, width, height, fov]);
  if (error) return <div className="hud-error" role="alert">Could not load the HUD fire texture.</div>;
  return <svg className="hud-overlay" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ opacity }} aria-label={`First-person fire preview, row ${row}, sheet 1`}>
    <defs><clipPath id={clipId}><rect width={width} height={height} /></clipPath></defs>
    <g clipPath={`url(#${clipId})`}>
      <FireTexels texels={texels} pixelGrid={pixelGrid} />
    </g>
  </svg>;
}
