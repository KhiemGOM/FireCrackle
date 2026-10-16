import { useEffect, useMemo, useState } from "react";
import fire1 from "../assets/fire_1.png";
import type { Backend, Flag } from "../lib/api";
import { relativePhase, type ChartPoint, type PhaseChart } from "../lib/chart";
import { compareFrames, describePoint, spriteRowOf } from "../lib/flagCompare";
import { flagText, priorityHint } from "../lib/flagText";
import { IconButton } from "./Icon";
import "./FlagCompare.css";

const OPEN_KEY = "firecrackle.flagCompare.open";

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true; // storage blocked: just stay open
  }
}

interface Props {
  backend: Backend;
  chart: PhaseChart;
  flag: Flag;
  fps: number;
  /** Open a frame in the Label tab. */
  onOpen: (frame: number) => void;
  onClose: () => void;
}

/** The decoded video frame as an object URL; null while loading or when there is no frame. */
function useFrameUrl(backend: Backend, frame: number | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (frame === null) return;
    let cancelled = false;
    let made: string | null = null;
    backend
      .frame(frame)
      .then((bytes) => {
        if (cancelled) return;
        made = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [backend, frame]);
  return url;
}

function Side({ title, point, reference, fps, backend, onOpen }: { title: string; point: ChartPoint | null; reference: number; fps: number; backend: Backend; onOpen: (frame: number) => void }) {
  const url = useFrameUrl(backend, point?.frame ?? null);
  const row = point ? spriteRowOf(point.step) : 0;
  return (
    <figure className={`compare-side${point ? "" : " empty"}`}>
      <figcaption className="compare-title">{title}</figcaption>
      <div className="compare-frame">
        {point ? url ? <img src={url} alt={`${title}: frame ${point.frame}`} draggable={false} /> : <span className="dim">loading frame…</span> : <span className="dim">no fire evidence here</span>}
        {point && (
          <span
            className="compare-sprite"
            title={`Animation index ${point.step}: row ${row}, sheet 1`}
            style={{ backgroundImage: `url(${fire1})`, backgroundSize: "48px 1536px", backgroundPosition: `0 -${row * 48}px` }}
          />
        )}
      </div>
      <div className="compare-text">{describePoint(point, reference, fps)}</div>
      {point && <IconButton icon="label" label={`Open frame ${point.frame} in Label`} onClick={() => onOpen(point.frame)}>Open in Label</IconButton>}
    </figure>
  );
}

/** Before and after a flag: the evidence frames on each side, each with the sprite it was matched to. */
export function FlagCompare({ backend, chart, flag, fps, onOpen, onClose }: Props) {
  const [open, setOpen] = useState(loadOpen);
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? "0" : "1");
      } catch {
        /* not remembered */
      }
      return !o;
    });
  const c = useMemo(() => compareFrames(chart.points, flag), [chart.points, flag]);
  const reference = chart.reference_phase ?? chart.runs[0]?.center ?? chart.points[0]?.phase ?? 0;
  const detail = chart.flag_details?.find((d) => d.frame === flag.frame && d.end_frame === flag.end_frame && d.kind === flag.kind);
  const text = flagText(flag.kind, detail?.explanation);
  const shift = c.before && c.after ? relativePhase(c.after.phase, c.before.phase) : null;
  return (
    <section className={`flag-compare${open ? "" : " collapsed"}`} aria-label="Flag comparison">
      <div className="compare-head">
        <button type="button" className="compare-toggle" aria-expanded={open} aria-controls="flag-compare-body" onClick={toggle} title={open ? "Collapse the comparison" : "Expand the comparison"}>
          <span className="compare-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="compare-heading">Compare around flag</span>
          <span className={`sev ${flag.severity}`} title={priorityHint(flag.severity)}>{flag.severity}</span>
          <b>{text.name}</b>
          <span className="dim compare-where">
            frame {flag.frame}
            {flag.end_frame > flag.frame ? `–${flag.end_frame}` : ""}
            {shift !== null ? ` · timing offset changes ${shift > 0 ? "+" : ""}${shift.toFixed(1)} ticks across it` : ""}
          </span>
        </button>
        <IconButton icon="reset" label="Close comparison" onClick={onClose} />
      </div>
      {open && (
        <div id="flag-compare-body">
          <p className="dim compare-note">{text.hint} {priorityHint(flag.severity)} Frames shown are the nearest fire evidence on each side, not necessarily adjacent frames.</p>
          <div className="compare-grid">
            <Side title="Before" point={c.before} reference={reference} fps={fps} backend={backend} onOpen={onOpen} />
            {c.during && <Side title="Inside the flag" point={c.during} reference={reference} fps={fps} backend={backend} onOpen={onOpen} />}
            <Side title="After" point={c.after} reference={reference} fps={fps} backend={backend} onOpen={onOpen} />
          </div>
        </div>
      )}
    </section>
  );
}
