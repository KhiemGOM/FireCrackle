import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { LabelSource } from "../lib/api";
import { Icon } from "./Icon";
import "./PhaseSourcePicker.css";

type Source = "independent" | LabelSource;
const sources: { value: Source; label: string; detail: string }[] = [
  { value: "independent", label: "Human + first-person tool", detail: "Default · excludes time guesses" },
  { value: "manual", label: "Human checked", detail: "Only labels confirmed by a person" },
  { value: "first_person", label: "First-person tool", detail: "Includes tool labels later checked by a person" },
];

export function PhaseSourcePicker({ value, onChange }: { value: Source; onChange: (source: Source) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const selected = Math.max(0, sources.findIndex(source => source.value === value));

  useEffect(() => {
    if (!open) return;
    options.current[selected]?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, selected]);

  function close() { setOpen(false); trigger.current?.focus(); }
  function navigate(event: KeyboardEvent, index: number) {
    // These keys belong to the picker while its menu is open.
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) event.stopPropagation();
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (index + 1) % sources.length;
    if (event.key === "ArrowUp") next = (index + sources.length - 1) % sources.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = sources.length - 1;
    if (next !== undefined) { event.preventDefault(); options.current[next]?.focus(); }
    if (event.key === "Escape") { event.preventDefault(); close(); }
  }

  return <div className="phase-source-picker" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <span className="phase-source-label" id={`${id}-label`}>Label source</span>
    <button type="button" className="phase-source-trigger" ref={trigger}
      aria-label={`Phase chart label source: ${sources[selected].label}`} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? `${id}-options` : undefined}
      onClick={() => setOpen(current => !current)} onKeyDown={event => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); }
      }}>
      <Icon name="filter" /><span>{sources[selected].label}</span>
      <svg className="phase-source-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && <div className="phase-source-menu" id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`}>
      {sources.map((source, index) => <button type="button" role="option" aria-selected={value === source.value}
        className="phase-source-option" key={source.value} tabIndex={index === selected ? 0 : -1}
        ref={element => { options.current[index] = element; }} onKeyDown={event => navigate(event, index)}
        onClick={() => { onChange(source.value); close(); }}>
        <span className="phase-source-check">{value === source.value && <Icon name="check" />}</span>
        <span><span className="phase-source-option-label">{source.label}</span><span className="phase-source-detail">{source.detail}</span></span>
      </button>)}
    </div>}
  </div>;
}
