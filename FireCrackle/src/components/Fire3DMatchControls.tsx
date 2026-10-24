// Match for the 3D quad (its own matching row while Match is on, the shared Match panel): every plane of the placed fire,
// where the solved camera puts it on the native frame, is matched in the picture worker and the planes vote on one shared
// phase and sprite (lib/fire3dMatch.ts). The best is previewed; three tries (lib/phaseConsensus.ts consensusTries) can be
// previewed with the buttons or M then 1-3. Only filtered sprites is the quad mask's matcher's setting; there are no mask
// changes (the camera and the fire's place set the planes). Previews only: the sprite is the 3D quad's own setting.
import { useEffect, useRef, useState } from "react";
import { planeToManualQuad } from "../lib/fireTool";
import type { FireQuad } from "../lib/reversal";
import type { MatchPlane, PlaneMatch, PlaneMatchCandidate } from "../lib/fire3dMatch";
import type { EdgeFilter } from "../lib/atlasFilter";
import { pictureTask } from "../lib/pictureWorker";
import { readFireAtlas } from "../lib/quadRefine";
import { failureMessage } from "../lib/appErrors";
import { matchPanel, useMatchOptions, useSaveMatchOptions } from "./MatchPanel";

interface Props {
  /** The fire's planes in native pixels, and the native picture size they are in. */
  quads: FireQuad[]; size: { width: number; height: number } | null;
  /** Names the shown picture; `load` reads it at native size. */
  picture: string; load: () => Promise<Blob>;
  material: "normal" | "soul";
  /** The atlas filters (used when Only filtered sprites is on). */ filter?: EdgeFilter;
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
    return m ? [{ quad: m.quad, mirrored: m.mirrored, sheet: (q.sheet === 1 ? 1 : 0) as 0 | 1 }] : [];
  });
}

export function Fire3DMatchControls({ quads, size, picture, load, material, filter, runToken, pick, disabled, onPreview }: Props) {
  const options = useMatchOptions(), { onlyFiltered, setOnlyFiltered } = options;
  const activeFilter = onlyFiltered ? filter : undefined;
  const planes = planesOf(quads, size);
  // a result belongs to its picture, planes (the camera and fire), atlas and filter
  const key = JSON.stringify([picture, material, activeFilter, planes.map(p => p.quad.map(c => c.map(v => Math.round(v * 1e4))))]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; data?: PlaneMatch | null; error?: string; selected?: PlaneMatchCandidate } | null>(null);
  const latest = useRef({ key, onPreview, planes, load, activeFilter });
  latest.current = { key, onPreview, planes, load, activeFilter };
  const handledRun = useRef(0), handledPick = useRef(0), token = useRef(0);
  const current = result?.key === key ? result : null;
  // M: run once the fire is there (and again when asked again)
  useEffect(() => {
    if (!runToken || runToken === handledRun.current || disabled || !planes.length || busy === key) return;
    handledRun.current = runToken;
    void find();
  }, [runToken, disabled, busy, key]); // eslint-disable-line react-hooks/exhaustive-deps
  // M then 1, 2, 3: preview that try as soon as it exists
  useEffect(() => {
    if (!pick || pick.n === handledPick.current || disabled) return;
    const candidate = current?.data?.candidates[pick.index];
    if (!candidate) return;
    handledPick.current = pick.n;
    preview(candidate);
  }, [pick, current, disabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useSaveMatchOptions(options);

  async function find() {
    const mine = ++token.current, { key: start, planes: mineplanes, activeFilter: mineFilter } = latest.current;
    if (!mineplanes.length) return;
    setBusy(start); setResult(null);
    try {
      const [sheets, blob] = await Promise.all([readFireAtlas(material), latest.current.load()]);
      const data = await pictureTask("match3d", { bytes: await blob.arrayBuffer(), sheets, planes: mineplanes, ...(mineFilter ? { filter: mineFilter } : {}) });
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
  const data = current?.data;
  const summary = !planes.length ? "Place the fire first: its planes are what is matched."
    : busy === key ? `Matching ${planes.length} planes…`
    : current?.error ? `Match failed: ${current.error}`
    : data?.searched === 0 ? "No sprites pass the atlas filters. Change the counts or turn off Only filtered sprites."
    : current && !data?.candidates.length ? "Too few visible fire pixels on the planes. Check the camera and the fire's place."
    : current?.selected ? `${data!.confident ? "Shared" : "Unsure shared"} guess (${data!.planes} planes): ${name(current.selected)}. Verify before confirming.`
    : `Matches all ${planes.length} planes together: one animation phase and one sprite.`;
  const info = [summary, `Atlas edges: left ${filter?.left ?? "Any"}, right ${filter?.right ?? "Any"}. ${onlyFiltered ? "Filters applied before matching." : "Searching all sprites."}`,
    data ? `Tried ${data.searched} / 128 sprites on ${data.planes} planes.` : "",
    data ? (data.confident ? "The planes agree on the phase: all three tries are at it." : "The planes are unsure of the phase: the third try is at the runner-up phase.") : "",
    "The planes stay where the camera and the fire's place put them.", "Results are previews; only Confirm/Enter saves a label."].filter(Boolean).join("\n");
  return matchPanel({ label: "3D quad match",
    find: { busy: busy === key, disabled: disabled || !planes.length, onClick: () => void find(),
      title: `Match every plane of the fire on the native frame (${onlyFiltered ? "sprites passing the atlas filters" : "all 128 sprite appearances"}); the planes vote on one animation phase and one sprite. Previews only; never saves a label.` },
    onlyFiltered: { checked: onlyFiltered, onChange: setOnlyFiltered },
    ranks: (data?.candidates ?? []).map((c, i) => ({ key: `${c.phase}-${c.sheet}-${c.mirrored}`, label: `Preview 3D match ${i + 1}: ${name(c)}`, pressed: current!.selected === c, onClick: () => preview(c),
      details: [`Match ${i + 1}: ${name(c)}`, `Support ${c.support.toFixed(1)} (summed over the planes)`, current!.selected === c ? "Currently previewed" : "Click to preview", `M then ${i + 1}`, "Confirm/Enter saves the label."].join("\n") })),
    ranksDisabled: disabled, info, summary, error: !!current?.error,
  });
}
