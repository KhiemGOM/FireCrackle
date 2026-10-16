import type { Flag } from "./api";
import type { ChartPoint, FlagDetail, PhaseChart } from "./chart";

/** One tick of capture/game scheduling slack beyond the normal tick-boundary allowance. */
export const FORWARD_TICK_SLACK = 1;

/** Share the same local review events on both chart clocks; phase stays available for inspection. */
export function forwardTransitionChart(chart: PhaseChart): PhaseChart {
  const {flags,details}=fireTransitions(chart.points,chart.tick_rate);
  return {...chart,flags,flag_details:details};
}

/** Local evidence only: never extrapolate across unlabelled/no-fire frames or clock gaps.
 * The forward modulo advance is a minimum: complete 32-tick cycles are invisible.
 * A violation means an implausible transition, not proof of an edit or its direction.
 */
export function fireTransitions(points: ChartPoint[], tickRate: number): { flags: Flag[]; details: FlagDetail[] } {
  const flags: Flag[] = [], details: FlagDetail[] = [];
  if (!Number.isFinite(tickRate) || tickRate <= 0) return { flags, details };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const elapsed = (b.video_pts ?? b.pts) - (a.video_pts ?? a.pts);
    if (b.frame !== a.frame + 1 || !Number.isFinite(elapsed) || elapsed <= 0) continue;
    if (![a.step, b.step].every(s => Number.isInteger(s) && s >= 0 && s < 32)) continue;
    // An unknown sub-tick starting position can cross ceil(elapsed * rate) boundaries.
    const allowed = Math.ceil(elapsed * tickRate - 1e-7) + FORWARD_TICK_SLACK;
    const forward = (b.step - a.step + 32) % 32;
    if (forward <= allowed) continue;
    const explanation = `forward_jump: Frames ${a.frame} → ${b.frame}: row ${a.step} → ${b.step} needs at least ${forward} forward ticks in ${(elapsed * 1000).toFixed(2)} ms; at ${tickRate} Hz at most ${allowed} are allowed, including one tick of scheduling slack. Check both labels and the footage. A reset, capture behaviour or an edit can cause this; the animation alone cannot establish direction or detect whole 32-tick cycles.`;
    const previous = flags[flags.length - 1];
    // Adjacent bad transitions (e.g. one bad label and its return) form one review event.
    if (previous && previous.end_frame === a.frame) {
      previous.end_frame = b.frame;
      const detail = details[details.length - 1];
      detail.end_frame = b.frame;
      if (forward - allowed > previous.phase_delta) {
        previous.phase_delta = forward - allowed;
        detail.clock_delta = previous.phase_delta;
        detail.explanation = explanation;
      }
    } else {
      const flag: Flag = { frame: b.frame, end_frame: b.frame, kind: "phase_shift", severity: "hard", phase_delta: forward - allowed };
      flags.push(flag);
      details.push({ ...flag, clock_delta: flag.phase_delta, held_ticks: null, explanation });
    }
  }
  return { flags, details };
}
