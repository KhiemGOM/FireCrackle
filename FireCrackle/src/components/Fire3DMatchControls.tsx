// Match for the 3D quad (M while it is on): every plane of the placed fire, where the solved camera puts it on the
// native frame, is matched in the picture worker and the planes vote on one shared phase and sprite (lib/fire3dMatch.ts).
// The best is previewed; the three best phases can be tried with the buttons or M then 1-3, as the quad mask's matcher
// (QuadMatchControls) does. Previews only: the sprite is the 3D quad's own setting.
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { planeToManualQuad } from "../lib/fireTool";
import type { FireQuad } from "../lib/reversal";
import type { MatchPlane, PlaneMatch, PlaneMatchCandidate } from "../lib/fire3dMatch";
import { pictureTask } from "../lib/pictureWorker";
import { readFireAtlas } from "../lib/quadRefine";
import { failureMessage } from "../lib/appErrors";
import "./QuadMatchControls.css";

interface Props {
  /** The fire's planes in native pixels, and the native picture size they are in. */
  quads: FireQuad[]; size: { width: number; height: number } | null;
  /** Names the shown picture; `load` reads it at native size. */
  picture: string; load: () => Promise<Blob>;
  material: "normal" | "soul";
  /** Increases to ask for a run (the M key). */ runToken: number;
  /** A request to preview the nth candidate (M then 1, 2, 3); `n` makes each request distinct. */ pick: { index: number; n: number } | null;
  disabled: boolean;
  onPreview: (candidate: PlaneMatchCandidate) => void;
}
const name = (c: PlaneMatchCandidate) => `phase ${c.phase} · sheet ${c.sheet} row ${c.row} · ${c.mirrored ? "mirrored" : "normal"}`;

function planesOf(quads: FireQuad[], size: Props["size"]): MatchPlane[] {
  if (!size) return [];
  return quads.flatMap(q => {
    const m = planeToManualQuad(q, size.width, size.height);
    return m ? [{ quad: m.quad, mirrored: m.mirrored, sheet: (q.sheet ? 1 : 0) as 0 | 1 }] : [];
  });
}

export function Fire3DMatchControls({ quads, size, picture, load, material, runToken, pick, disabled, onPreview }: Props) {
  const planes = planesOf(quads, size);
  // a result belongs to its picture, planes (the camera and fire) and atlas
  const key = JSON.stringify([picture, material, planes.map(p => p.quad.map(c => c.map(v => Math.round(v * 1e4))))]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; data?: PlaneMatch | null; error?: string; selected?: PlaneMatchCandidate } | null>(null);
  const latest = useRef({ key, onPreview, planes, load });
  latest.current = { key, onPreview, planes, load };
  const handledRun = useRef(0), handledPick = useRef(0), token = useRef(0);
  const current = result?.key === key ? result : null;
  // M: run once the fire is there (and again when asked again)
  useEffect(() => {
    if (!runToken || runToken === handledRun.current || disabled || !planes.length || busy === key) return;
    handledRun.current = runToken;
    void find();
  }, [runToken, disabled, busy, key]); // eslint-disable-line react-hooks/exhaustive-deps
  // M then 1, 2, 3: preview that phase as soon as it exists
  useEffect(() => {
    if (!pick || pick.n === handledPick.current || disabled) return;
    const candidate = current?.data?.candidates[pick.index];
    if (!candidate) return;
    handledPick.current = pick.n;
    preview(candidate);
  }, [pick, current, disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  async function find() {
    const mine = ++token.current, start = latest.current.key, mineplanes = latest.current.planes;
    if (!mineplanes.length) return;
    setBusy(start); setResult(null);
    try {
      const [sheets, blob] = await Promise.all([readFireAtlas(material), latest.current.load()]);
      const data = await pictureTask("match3d", { bytes: await blob.arrayBuffer(), sheets, planes: mineplanes });
      if (mine !== token.current || latest.current.key !== start) return;
      const best = data?.candidates[0];
      setResult({ key: start, data, selected: best });
      if (best) latest.current.onPreview(best);
    } catch (e) {
      if (mine === token.current && latest.current.key === start) setResult({ key: start, error: failureMessage(e) });
    } finally {
      if (mine === token.current) setBusy(null);
    }
  }
  function preview(candidate: PlaneMatchCandidate) {
    if (!current?.data || disabled) return;
    setResult({ ...current, selected: candidate });
    onPreview(candidate);
  }
  const summary = !planes.length ? "Place the fire first: its planes are what is matched."
    : busy === key ? `Matching ${planes.length} planes…`
    : current?.error ? `Match failed: ${current.error}`
    : current && !current.data?.candidates.length ? "Too few visible fire pixels on the planes. Check the camera and the fire's place."
    : current?.selected ? `${current.data!.confident ? "Shared" : "Unsure shared"} guess (${current.data!.planes} planes): ${name(current.selected)}. Verify before confirming.`
    : `Matches all ${planes.length} planes together: one animation phase and one sprite.`;
  return <div className="match-controls" aria-label="3D quad match">
    <button className="icon-button with-text" style={{ whiteSpace: "nowrap", flexShrink: 0 }} disabled={disabled || !planes.length || busy === key} onClick={() => void find()}
      title="Match every plane of the fire on the native frame; the planes vote on one animation phase and one sprite. Previews only.">
      <Icon name="zoomIn" /> {busy === key ? "Matching…" : "Find 3D match"}
    </button>
    {current?.data?.candidates.map((c, i) =>
      <button key={c.phase} className="match-rank" disabled={disabled} aria-label={`Preview 3D match ${i + 1}: ${name(c)}`} aria-pressed={current.selected === c}
        title={`${name(c)}\nSupport ${c.support.toFixed(1)} (summed over the planes)`} onClick={() => preview(c)}>{i + 1}</button>)}
    <span className="hud-hint">{summary}</span>
  </div>;
}
