import type { CheckResult, LatestRelease } from "../lib/updateCheck";
import "./UpdateBanner.css";

interface Props {
  localVersion: string;
  auto: boolean;
  lastCheckMs: number | null;
  status: "idle" | "checking" | "available" | "current" | "error";
  message: string | null;
  release: LatestRelease | null;
  nowMs: number;
  onAuto: (auto: boolean) => void;
  onCheck: () => void;
  onOpen: (url: string) => void;
  onClose: () => void;
}

/** Where a CheckResult stands, for the dialog. */
export function statusOf(result: CheckResult | null, checking: boolean): Props["status"] {
  return checking ? "checking" : result ? result.state : "idle";
}

export function UpdatesDialog({ localVersion, auto, lastCheckMs, status, message, release, onAuto, onCheck, onOpen, onClose }: Props) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal updates-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Software updates"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="modal-head">
          <h2>Software updates</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <p>You have FireCrackle {localVersion}.</p>
          <p className="dim">{lastCheckMs === null ? "Never checked." : `Last checked ${new Date(lastCheckMs).toLocaleString()}.`}</p>
          <div className="update-check">
            <button type="button" className="on" disabled={status === "checking"} onClick={onCheck}>Check now</button>
            {status === "checking" && <span role="status"> Checking…</span>}
            {status === "current" && <span role="status"> You are up to date.</span>}
          </div>
          {status === "error" && message && <p role="alert">{message}</p>}
          {status === "available" && release && (
            <>
              <p><strong>FireCrackle {release.version} is available.</strong></p>
              {release.notes && <pre className="update-notes">{release.notes}</pre>}
              <button type="button" onClick={() => onOpen(release.pageUrl)}>Release page</button>
            </>
          )}
          <label className="update-auto">
            <input type="checkbox" aria-label="Check for updates automatically" checked={auto} onChange={e => onAuto(e.target.checked)} /> Check for updates automatically
          </label>
          <p className="dim">
            FireCrackle asks GitHub for the project's latest release once a day: one request that says nothing about you or your videos. Turn the switch off to stop it; "Check now" still works.
          </p>
        </div>
      </div>
    </div>
  );
}
