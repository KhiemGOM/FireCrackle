import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "./Icon";
import type { ProofAction, ProofFormat } from "../lib/comparisonProof";
import "./ComparisonProofButton.css";

export const proofOptions: {format: ProofFormat; text: string}[] = [
  {format: "webp", text: "WebP · lossless animation (default)"},
  {format: "gif", text: "GIF · animation"},
  {format: "png", text: "PNG · still image"},
  {format: "jpeg", text: "JPEG · still image"},
];

export function ComparisonProofButton({disabled, busy, feedback, onExport, label = "Comparison proof", title = "Copy a lossless animated WebP close-up: the aligned fire overlay fades in and out, ready to paste into Discord"}: {
  disabled: boolean; busy: boolean; feedback?: string; onExport: (action: ProofAction) => void; label?: string; title?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]), id = useId();
  useEffect(() => {
    if (!open) return;
    options.current[0]?.focus();
    const dismiss = (event: PointerEvent) => {if (!root.current?.contains(event.target as Node)) setOpen(false);};
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const close = () => {setOpen(false); trigger.current?.focus();};
  function navigate(event: KeyboardEvent, index: number) {
    event.stopPropagation();
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (index + 2) % (proofOptions.length * 2);
    if (event.key === "ArrowUp") next = (index + proofOptions.length * 2 - 2) % (proofOptions.length * 2);
    if (event.key === "ArrowRight") next = index % 2 === 0 ? index + 1 : index;
    if (event.key === "ArrowLeft") next = index % 2 === 1 ? index - 1 : index;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = proofOptions.length * 2 - 1;
    if (next !== undefined) {event.preventDefault(); options.current[next]?.focus();}
    if (event.key === "Escape") {event.preventDefault(); close();}
  }
  return <div className="comparison-proof-button" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <IconButton icon="copy" label={label} data-owns-keys="true" title={title}
      disabled={disabled || busy} onClick={() => {setOpen(false); onExport({format: "webp", destination: "copy"});}}>{busy ? "Creating…" : feedback || label}</IconButton>
    <button type="button" className="proof-dropdown-trigger" data-owns-keys="true" ref={trigger} aria-label="Comparison proof formats"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled || busy}
      title="Copy a format, or use its save icon to download" onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {event.preventDefault(); event.stopPropagation(); setOpen(true);}
      }}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" /></svg></button>
    {open && <div className="comparison-proof-menu" id={id} role="menu" aria-label="Comparison proof formats">
      {proofOptions.map((option, index) => <div className="comparison-proof-option" key={option.format} role="none">
        <button type="button" role="menuitem" data-owns-keys="true" aria-label={`Copy ${option.format.toUpperCase()}`} title={`Copy ${option.format.toUpperCase()}`}
          ref={element => {options.current[index * 2] = element;}} onKeyDown={event => navigate(event, index * 2)}
          disabled={busy || disabled} onClick={() => {close(); onExport({format: option.format, destination: "copy"});}}>{option.text}</button>
        <button type="button" role="menuitem" data-owns-keys="true" aria-label={`Save ${option.format.toUpperCase()}`} title={`Save ${option.format.toUpperCase()} file`}
          ref={element => {options.current[index * 2 + 1] = element;}} onKeyDown={event => navigate(event, index * 2 + 1)}
          disabled={busy || disabled} onClick={() => {close(); onExport({format: option.format, destination: "save"});}}><svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg></button>
      </div>)}
    </div>}
  </div>;
}
