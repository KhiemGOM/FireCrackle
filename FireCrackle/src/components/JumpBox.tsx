import { useEffect, useRef, useState } from "react";
import { resolveJump } from "../lib/jump";
import { formatTimecode } from "../lib/timecode";
import "./JumpBox.css";

interface Props {
  current: number;
  frameCount: number;
  pts: number;
  fps: number;
  onJump: (frame: number) => void;
  /** The backend's frame nearest a time (`jolt_frame`); without it the time is estimated from the frame rate. */
  locate?: (seconds: number) => Promise<number>;
}

/** The status bar's frame number and timecode; click either to type a frame or a time and jump there. */
export function JumpBox({ current, frameCount, pts, fps, onJump, locate }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const open = text !== null;
  useEffect(() => {
    if (open) field.current?.select();
  }, [open]);
  const timecode = formatTimecode(pts, fps);
  const start = (value: string) => {
    setText(value);
    setError(null);
  };
  const close = () => {
    setText(null);
    setError(null);
  };
  const submit = async (value: string) => {
    const r = await resolveJump(value, { fps, frameCount, current, pts }, locate);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    close();
    onJump(r.frame);
  };
  if (open) {
    return (
      <span className="jump-box">
        <input
          ref={field}
          autoFocus
          data-owns-keys={true}
          className={error ? "jump-input bad" : "jump-input"}
          aria-label="Jump to a frame number or a time HH:MM:SS|FF"
          placeholder="frame or HH:MM:SS|FF"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onBlur={close}
          onKeyDown={(e) => {
            // the box owns every key: app shortcuts (arrows, Space, the M chord) must not fire while typing
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              void submit(text);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        {error && <span className="jump-error" role="alert">{error}</span>}
      </span>
    );
  }
  return (
    <>
      <span>
        frame{" "}
        <button type="button" className="jump-target" title="Type a frame number to jump to" onClick={() => start(String(current))}>
          {current}
        </button>{" "}
        / {frameCount - 1}
      </span>
      <button type="button" className="jump-target" title="Type a time HH:MM:SS|FF to jump to" onClick={() => start(timecode)}>
        {timecode}
      </button>
    </>
  );
}
