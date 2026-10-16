import type { FlagKind,Severity } from "./api";

export function priorityHint(severity:Severity):string {
  if(severity==='jolt')return 'Imported Jolt report flag. This is a reported interval, separate from the fire checker’s hard/soft priority.';
  return severity==="hard"
    ? "Large timing discrepancy: inspect the footage. Lag or a capture hold can cause this too."
    : "Timing discrepancy or recovery: inspect if relevant; the cause is uncertain.";
}

export function flagText(kind:FlagKind,explanation?:string):{name:string;hint:string} {
  if(explanation?.startsWith("jolt_removed:"))return {name:"Jolt · reported cut interval",hint:explanation.slice("jolt_removed:".length).trim()};
  if(explanation?.startsWith("jolt_stalled:"))return {name:"Jolt · reported clock stall",hint:explanation.slice("jolt_stalled:".length).trim()};
  if(explanation?.startsWith("forward_jump:"))return {name:"Forward animation jump",hint:explanation.slice("forward_jump:".length).trim()};
  switch(explanation) {
    case "recovered_hold":return {name:"Held animation · recovered",hint:"The row held still, then observations returned to the original clock extrapolated through the hold. Separate odd labels remain flagged."};
    case "hold_with_mismatch":return {name:"Held animation · mismatch",hint:"The row held still and later observations retain a timing mismatch against the original clock. Lag, a reset, an edit or labels may explain it."};
    case "hold_recovery_unknown":return {name:"Held animation · recovery unknown",hint:"The row held still, but there are too few observations before or after it to establish timing recovery."};
    case "persistent_mismatch":return {name:"Clock mismatch",hint:"The observations settle at a different clock phase. The cause could be a timing change, an edit, a reset or labels."};
    case "recovered_departure":return {name:"Timing departure · returned",hint:"The timing left its local level and returned. A stall is possible; the cause is not established."};
  }
  if(kind==="phase_outlier")return {name:"Odd observation",hint:"A short stretch differs from nearby observations. Check the row and the footage; timing or capture behaviour can also cause this."};
  if(kind==="phase_excursion")return {name:"Timing departure",hint:"The phase departed from nearby timing. Check the footage and the recovery evidence."};
  return {name:"Clock mismatch",hint:"The observed phase changes. Lag, an edit, a reset or labels may explain it."};
}
