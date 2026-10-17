import { chooseDownloads, installSteps, type InstallKind, type LatestRelease } from "../lib/updateCheck";
import "./UpdateBanner.css";

interface Props {
  release: LatestRelease;
  localVersion: string;
  kind: InstallKind;
  /** Open a URL in the browser (only ever this project's own release URLs). */
  onOpen: (url: string) => void;
  onSkip: () => void;
  onLater: () => void;
  onDetails: () => void;
}

/** A newer version exists. Downloading and installing it are the user's steps; this says which file and how. */
export function UpdateBanner({ release, localVersion, kind, onOpen, onSkip, onLater, onDetails }: Props) {
  const { primary, others } = chooseDownloads(release, kind);
  const downloads = primary ? [primary] : others;
  return (
    <div className="update-banner" role="status">
      <div className="update-line">
        <strong>FireCrackle {release.version} is available</strong>
        <span> (you have {localVersion}).</span>
        <span className="update-actions">
          {downloads.map(a => (
            <button type="button" key={a.name} className="on" aria-label={`Download ${a.name}`} title={`${a.name}${a.size ? ` · ${(a.size / 1048576).toFixed(1)} MB` : ""}`} onClick={() => onOpen(a.url)}>
              {primary ? "Download" : `Download ${a.name.replace(/^FireCrackle-[^-]+-/, "")}`}
            </button>
          ))}
          <button type="button" onClick={() => onOpen(release.pageUrl)}>Release page</button>
          <button type="button" onClick={onDetails}>What's new</button>
          <button type="button" onClick={onSkip}>Skip this version</button>
          <button type="button" onClick={onLater}>Later</button>
        </span>
      </div>
      {primary?.sha256 && (
        <div className="update-hash">
          SHA-256 of the download: <code>{primary.sha256}</code>
        </div>
      )}
      <ol className="update-steps">
        {installSteps(kind).map(step => <li key={step}>{step}</li>)}
      </ol>
    </div>
  );
}
