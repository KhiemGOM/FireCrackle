import { useState } from "react";
import { scopedStorage } from "../lib/scopedStorage";

/** Acknowledgements apply only to this video's current notes; changed notes appear again. */
export function VideoNotes({ videoPath, warnings }: { videoPath?: string; warnings: string[] }) {
  const signature = JSON.stringify(warnings);
  const storage = scopedStorage(`video:${videoPath ?? "preview"}`);
  const [acknowledged, setAcknowledged] = useState(() => {
    try { return storage.getItem("acknowledged-notes") === signature; }
    catch { return false; }
  });
  if (acknowledged || warnings.length === 0) return null;

  function acknowledge() {
    setAcknowledged(true);
    try { storage.setItem("acknowledged-notes", signature); }
    catch { /* Dismiss for this session even if browser storage is unavailable. */ }
  }

  return (
    <div className="banner warn" style={{ position: "relative", paddingRight: 44 }}>
      <details>
        <summary>{warnings.length} note{warnings.length > 1 ? "s" : ""} about this video</summary>
        <ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </details>
      <button type="button" aria-label="Acknowledge video notes" title="Acknowledge and dismiss these notes"
        onClick={acknowledge} style={{ position: "absolute", top: 4, right: 8, fontSize: 18, lineHeight: 1, padding: "2px 6px" }}>×</button>
    </div>
  );
}
