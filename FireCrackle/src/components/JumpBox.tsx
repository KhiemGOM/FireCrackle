import { useEffect, useRef, useState } from "react";
import { resolveJump } from "../lib/jump";
import { formatTimecodeFor } from "../lib/timecode";
import "./JumpBox.css";

interface Props {
  current: number;
  frameCount: number;
  pts: number;
  fps: number;
  onJump: (frame: number) => void;
  locate?: (seconds: number) => Promise<number>;
}

/** Keep punctuation fixed, including when pasting a compact numeric time. */
function maskedTime(value: string, template: string) {
  const digits = value.replace(/\D/g, "");
  const count = template.replace(/\D/g, "").length;
  if (digits.length > count) return null;
  const padded = digits.padStart(count, "0");
  let i = 0;
  return template.replace(/\d/g, () => padded[i++]);
}

export function JumpBox({ current, frameCount, pts, fps, onJump, locate }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [bare, setBare] = useState<"frame" | "time">("frame");
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);
  const revision = useRef(0);
  const open = text !== null;
  useEffect(() => {
    if (open) field.current?.select();
  }, [open, bare]);
  useEffect(() => {
    if (caret.current !== null) {
      field.current?.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [text]);
  const timecode = formatTimecodeFor(pts, fps, frameCount / Math.max(fps, 1));
  const start = (value: string, as: "frame" | "time") => {
    revision.current++;
    setText(value);
    setBare(as);
    setError(null);
  };
  const close = () => {
    revision.current++;
    setText(null);
    setError(null);
  };
  const submit = async (value: string) => {
    const request = revision.current;
    const r = await resolveJump(value, { fps, frameCount, current, pts }, locate, { bare });
    if (request !== revision.current) return;
    if ("error" in r) { setError(r.error); return; }
    close();
    onJump(r.frame);
  };
  const control = (kind: "frame" | "time", label: string, title: string) => {
    const editing = open && bare === kind;
    return (
      <span className="jump-slot">
        <button type="button" className="jump-target" title={title}
          style={editing ? { visibility: "hidden" } : undefined}
          aria-hidden={editing || undefined} tabIndex={editing ? -1 : undefined}
          onClick={() => start(label, kind)}>{label}</button>
        {editing && <input ref={field} autoFocus data-owns-keys={true}
          className={error ? "jump-input bad" : "jump-input"}
          aria-label={kind === "frame" ? "Jump to frame" : "Jump to time"}
          aria-invalid={!!error} spellCheck={false} value={text}
          onChange={(e) => {
            const next = kind === "time" ? maskedTime(e.target.value, label) : e.target.value;
            if (next !== null) setText(next);
            setError(null);
          }}
          onBlur={close}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); void submit(text); }
            else if (e.key === "Escape") { e.preventDefault(); close(); }
            else if (kind === "time" && !e.ctrlKey && !e.metaKey &&
              (/^\d$/.test(e.key) || e.key === "Backspace" || e.key === "Delete")) {
              e.preventDefault();
              const el = e.currentTarget;
              let a = el.selectionStart ?? 0;
              const b = el.selectionEnd ?? a;
              const chars = text.split("");
              if (b > a) {
                for (let i = a; i < b; i++) if (/\d/.test(chars[i])) chars[i] = "0";
              } else if (e.key === "Backspace") {
                do { a--; } while (a >= 0 && !/\d/.test(chars[a]));
              }
              while (a < chars.length && a >= 0 && !/\d/.test(chars[a])) a++;
              if (a >= 0 && a < chars.length) chars[a] = /^\d$/.test(e.key) ? e.key : "0";
              let next = /^\d$/.test(e.key) ? a + 1 : Math.max(a, 0);
              while (next < chars.length && !/\d/.test(chars[next])) next++;
              caret.current = next;
              setText(chars.join(""));
              // Also move the caret when replacing a digit with the same digit.
              el.setSelectionRange(next, next);
              setError(null);
            }
          }} />}
        {editing && error && <span className="jump-error" role="alert">{error}</span>}
      </span>
    );
  };
  return <>
    <span>frame{" "}{control("frame", String(current), "Type a frame number to jump to")}{" "}/ {frameCount - 1}</span>
    {control("time", timecode, "Type a time to jump to")}
  </>;
}
