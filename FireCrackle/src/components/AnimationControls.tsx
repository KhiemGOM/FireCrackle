import { useEffect, useRef, useState } from "react";
import { animationPool, appearanceId, nextAppearance, type AtlasEdges, type EdgeFilter } from "../lib/atlasFilter";
import type { PreviewSprite } from "../lib/firePreview";
import { readPreferences, writePreferences } from "../lib/preferences";
import { IconButton } from "./Icon";
import "./AnimationControls.css";

interface Props {
  current: PreviewSprite; edges: AtlasEdges | null; filter?: EdgeFilter;
  frame: number; stopToken: number; disabled: boolean;
  onStart?: () => void; onPreview: (sprite: PreviewSprite) => void;
}
export function AnimationControls({ current, edges, filter, frame, stopToken, disabled, onStart, onPreview }: Props) {
  const saved = readPreferences();
  const [delay, setDelay] = useState(saved.animationDelayMs);
  const [onlyFiltered, setOnlyFiltered] = useState(saved.animationOnlyFiltered);
  const [playing, setPlaying] = useState(false);
  const pool = animationPool(edges, onlyFiltered ? filter : undefined);
  const poolKey = pool.map(sprite => appearanceId(sprite.sheet, sprite.row, sprite.mirrored)).join(",");
  const latest = useRef({ current, onPreview, pool }); latest.current = { current, onPreview, pool };
  useEffect(() => { writePreferences({ animationDelayMs: delay, animationOnlyFiltered: onlyFiltered }); }, [delay, onlyFiltered]);
  useEffect(() => { setPlaying(false); }, [frame, stopToken, disabled]);
  useEffect(() => {
    if (disabled || !pool.length) { setPlaying(false); return; }
    if (!playing) return;
    const timer = window.setInterval(() => {
      const next = nextAppearance(latest.current.pool, latest.current.current);
      if (next) { latest.current.current = next; latest.current.onPreview(next); }
    }, delay);
    return () => window.clearInterval(timer);
  }, [playing, delay, poolKey, disabled]);
  function step(direction: number) {
    setPlaying(false); onStart?.();
    const next = nextAppearance(pool, current, direction); if (next) onPreview(next);
  }
  const index = pool.findIndex(sprite => appearanceId(sprite.sheet, sprite.row, sprite.mirrored) === appearanceId(current.sheet, current.row, current.mirrored));
  const waiting = onlyFiltered && filter && (filter.left !== null || filter.right !== null) && !edges;
  const details = `${waiting ? "Reading edge counts" : pool.length ? "Loop every eligible sprite" : "No sprites pass the filters"}\nPreview: row ${current.row}, sheet ${current.sheet}, ${current.mirrored ? "mirrored" : "normal"}\n${onlyFiltered ? "Uses edge filters and manual exclusions" : "All 128 appearances, ignoring filters"}\nPreview only. Use the displayed preview as candidate, then Confirm/Enter to label.`;
  return <div className="animation-controls" aria-label="Sprite animation controls">
    <IconButton icon={playing ? "pause" : "play"} label={playing ? "Pause sprite animation" : "Play sprite animation"} disabled={disabled || !pool.length} onClick={() => { if (!playing) onStart?.(); setPlaying(!playing); }}>{playing ? "Pause" : "Play"}</IconButton>
    <IconButton icon="left" label="Previous animation appearance" disabled={disabled || !pool.length} onClick={() => step(-1)} />
    <IconButton icon="right" label="Next animation appearance" disabled={disabled || !pool.length} onClick={() => step(1)} />
    <label>Delay <input aria-label="Sprite animation delay in milliseconds" type="number" min={30} max={10000} step={10} value={delay} onChange={e => { const n = e.target.valueAsNumber; if (Number.isInteger(n) && n >= 30 && n <= 10000) setDelay(n); }} /> ms</label>
    <label><input aria-label="Animate filtered sprites only" type="checkbox" checked={onlyFiltered} onChange={e => setOnlyFiltered(e.target.checked)} /> Filtered only</label>
    <IconButton icon="info" label="Sprite animation details" title={details}>{index < 0 ? "—" : index + 1}/{pool.length}</IconButton>
  </div>;
}
