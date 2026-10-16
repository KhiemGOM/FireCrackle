import type { Flag } from "../lib/api";
import type { FlagDetail } from "../lib/chart";
import { flagText,priorityHint } from "../lib/flagText";
import { formatTimecode } from "../lib/timecode";

interface Props {
  flags: Flag[];
  fps: number;
  current: number;
  onSeek: (frame: number) => void;
  details?: FlagDetail[];
  onHover?: (flag: Flag | null) => void;
  onSelect?: (flag: Flag, openVideo: boolean) => void;
}

/** The phase flags, each clickable to jump to that frame. */
export function FlagsPanel({ flags, fps, current, onSeek,details=[],onHover,onSelect }: Props) {
  return (
    <div className="flags">
      <div className="panel-title">
        Phase flags <span className="count">{flags.length}</span>
      </div>
      {flags.length === 0 && <div className="empty">Nothing suspicious in the labelled frames.</div>}
      <ul>
        {flags.map((f) => {
          const inside = current >= f.frame && current <= f.end_frame;
          const detail=details.find(d=>d.frame===f.frame&&d.end_frame===f.end_frame&&d.kind===f.kind);
          const text=flagText(f.kind,detail?.explanation);
          return (
            <li key={`${f.frame}-${f.kind}`} className={inside ? "inside" : ""}>
              <button onClick={(e) => onSelect ? onSelect(f, e.ctrlKey) : onSeek(f.frame)}
                onMouseEnter={() => onHover?.(f)} onMouseLeave={() => onHover?.(null)}
                onFocus={() => onHover?.(f)} onBlur={() => onHover?.(null)}
                title={`${text.hint} ${priorityHint(f.severity)}${onSelect ? " Click to focus charts · Ctrl+click to open video." : ""}`}>
                <span className={`sev ${f.severity}`} title={priorityHint(f.severity)}>{f.severity}</span>
                <span className="kind">{text.name}</span>
                <span className="where">
                  frame {f.frame}
                  {f.end_frame > f.frame ? `–${f.end_frame}` : ""} · {formatTimecode(f.frame / (fps || 1), fps)}
                </span>
                <span className="delta">{detail?.held_ticks!=null?`held ${detail.held_ticks.toFixed(1)} ticks · `:""}{detail?.explanation.startsWith("forward_jump:")?"excess":"Δ"} {f.phase_delta > 0 ? "+" : ""}{f.phase_delta.toFixed(1)} ticks</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
