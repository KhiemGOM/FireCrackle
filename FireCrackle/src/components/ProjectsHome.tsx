import { projectKey, type ProjectEntry } from "../lib/projects";
import { Icon, IconButton } from "./Icon";
import "./ProjectsHome.css";

interface Props {
  projects: ProjectEntry[];
  /** videoPath of the project that is open right now */
  current?: string;
  opening: boolean;
  mock: boolean;
  path: string;
  onPath: (path: string) => void;
  onOpenProject: (videoPath: string, frame: number) => void;
  onForget: (videoPath: string) => void;
  onChooseVideo: () => void;
  onOpenPath: () => void;
  onOpenLink: () => void;
}

function folderOf(videoPath: string) {
  const i = Math.max(videoPath.lastIndexOf("/"), videoPath.lastIndexOf("\\"));
  return i > 0 ? videoPath.slice(0, i) : "";
}

/** Home: pick a project (one per video) or import a new video, which becomes a new project. */
export function ProjectsHome({ projects, current, opening, mock, path, onPath, onOpenProject, onForget, onChooseVideo, onOpenPath, onOpenLink }: Props) {
  return (
    <div className="projects-home">
      <h1>Projects</h1>
      <p>Each video is its own project, with its own labels. Importing a new video starts a new project.</p>
      <div className="projects-import">
        <button className="big" onClick={onChooseVideo} disabled={opening}>{opening ? "importing…" : "Import video…"}</button>
        <button onClick={onOpenLink} disabled={opening}>Import from link</button>
      </div>
      {!mock && (
        <div className="path-entry">
          <input value={path} onChange={(e) => onPath(e.target.value)} placeholder="or paste a video path or link" aria-label="Video path or link" />
          <button onClick={onOpenPath} disabled={!path || opening}>Import</button>
        </div>
      )}
      {projects.length === 0 ? (
        <p className="projects-empty">No projects yet. Import a video to start one.</p>
      ) : (
        <ul className="projects-list" aria-label="Projects">
          {projects.map((p) => {
            const isCurrent = !!current && projectKey(p.videoPath) === projectKey(current);
            const share = p.frameCount > 0 ? Math.min(1, p.labelled / p.frameCount) : 0;
            return (
              <li key={p.videoPath} className={`project-card${isCurrent ? " current" : ""}`}>
                <button className="project-open" disabled={opening} onClick={() => onOpenProject(p.videoPath, p.frame)} title={p.videoPath}>
                  <strong>{p.name}</strong>
                  <span className="project-folder">{folderOf(p.videoPath)}</span>
                  <span className="project-meta">
                    {p.frameCount > 0 ? `${p.labelled.toLocaleString()} / ${p.frameCount.toLocaleString()} frames labelled · ` : ""}
                    frame {p.frame.toLocaleString()} · opened {new Date(p.openedAt).toLocaleString()}
                  </span>
                  {p.frameCount > 0 && <progress aria-label={`${p.name} labelling progress`} max={1} value={share} />}
                </button>
                {isCurrent
                  ? <span className="project-now"><Icon name="check" /> Open now</span>
                  : <IconButton icon="erase" label={`Remove ${p.name} from the list`} title="Remove from this list. The video and its labels stay on disk; importing it again brings the project back." onClick={() => onForget(p.videoPath)} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
