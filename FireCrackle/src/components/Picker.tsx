import { useEffect, useRef, useState, type CSSProperties } from "react";
import fire0 from "../assets/fire_0.png";
import fire1 from "../assets/fire_1.png";
import { COLUMNS, ROWS, columnHeader, labelToCell, suggestionCells, type Label } from "../lib/grid";
import type { PreviewSprite } from "../lib/firePreview";
import type { View } from "../lib/api";
import { pickerLayout } from "../lib/pickerLayout";
import { appearanceEdges, appearanceId, edgeFilterValue, matchesAppearance, matchingAppearances, sheetEdgeCounts, type AtlasEdges, type EdgeFilter } from "../lib/atlasFilter";
import { Icon, IconButton } from "./Icon";
import "./Picker.css";

interface Props {
  previewOnly?: boolean;
  filter?: EdgeFilter;
  onFilterChange?: (filter: EdgeFilter) => void;
  onEdgesChange?: (edges: AtlasEdges | null) => void;
  onNoFire?: () => void;
  view: View;
  candidate?: Label | null;
  preview?: PreviewSprite | null;
  /** sprite size in px; the 16 px sprites are shown scaled */
  cell: number;
  /** The animation index is shared by both sheets and the backend. */
  onCell: (col: number, row: number, ctrlKey: boolean) => void;
}

/** The 32 sprite rows, divided into equal blocks to fit the panel. */
export function Picker({ view, cell, onCell, candidate = null, preview = null, filter, onFilterChange, onNoFire, onEdgesChange, previewOnly = false }: Props) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [localLeft, setLocalLeft] = useState<number | null>(null);
  const [localRight, setLocalRight] = useState<number | null>(null);
  const [localExcluded, setLocalExcluded] = useState<number[]>([]);
  const { left, right } = filter ?? { left: localLeft, right: localRight };
  const excluded = filter ? filter.excluded ?? [] : localExcluded;
  const activeFilter = { left, right, ...(excluded.length ? { excluded } : {}) };
  const setLeft = (value: number | null) => { setLocalLeft(value); onFilterChange?.({ ...activeFilter, left: value }); };
  const setRight = (value: number | null) => { setLocalRight(value); onFilterChange?.({ ...activeFilter, right: value }); };
  const setExcluded = (values: number[]) => { setLocalExcluded(values); onFilterChange?.({ left, right, excluded: values }); };
  const [edges, setEdges] = useState<AtlasEdges | null>(null);
  const [edgeError, setEdgeError] = useState(false);
  useEffect(() => { onEdgesChange?.(edges); }, [edges, onEdgesChange]);
  useEffect(() => {
    let cancelled = false;
    const load = (src: string) => new Promise<ReturnType<typeof sheetEdgeCounts>>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          if (image.naturalWidth !== 16 || image.naturalHeight !== 512) throw new Error("Invalid fire sprite sheet");
          const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 512;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas unavailable");
          ctx.drawImage(image, 0, 0);
          resolve(sheetEdgeCounts(ctx.getImageData(0, 0, 16, 512).data));
        } catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error("Could not load fire pixels"));
      image.src = src;
    });
    void Promise.all([load(fire0), load(fire1)]).then((counts) => { if (!cancelled) setEdges(counts); }).catch(() => { if (!cancelled) setEdgeError(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(picker);
    return () => observer.disconnect();
  }, []);
  const { blocks, rowsPerBlock, cell: CELL } = pickerLayout(size.width, size.height, cell);
  const current = labelToCell(view.label);
  const chosen = candidate ? labelToCell(candidate) : null;
  const shown = preview ? labelToCell({ fire: preview }) : null;
  const sug = view.suggestion ? suggestionCells(view.suggestion) : { primary: null, alt: null };
  const targetRef = useRef<HTMLDivElement | null>(null);

  const focusRow = chosen?.row ?? shown?.row ?? sug.primary?.row ?? current?.row ?? null;
  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusRow, blocks, CELL]);

  const filterActive = left !== null || right !== null;
  return (<>
    <div className="atlas-options" onKeyDown={(e) => e.stopPropagation()}>
    <section className="atlas-filters" aria-label="Visual sprite filters">
      <div className="atlas-filter-heading"><Icon name="filter" /><strong>Edge pixels</strong><span role="status">{edgeError ? "Counts unavailable" : edges ? `${matchingAppearances(edges, activeFilter)} / 128 match` : "Reading pixels…"}</span></div>
      <div className="atlas-filter-inputs">
        <label>Left <input type="number" min={0} max={16} step={1} placeholder="Any" aria-label="Left edge fire pixels" value={left ?? ""} onChange={(e) => setLeft(edgeFilterValue(e.target.value))} /></label>
        <label>Right <input type="number" min={0} max={16} step={1} placeholder="Any" aria-label="Right edge fire pixels" value={right ?? ""} onChange={(e) => setRight(edgeFilterValue(e.target.value))} /></label>
        <IconButton icon="reset" label="Clear edge pixel filters" disabled={!filterActive} onClick={() => { setLocalLeft(null); setLocalRight(null); onFilterChange?.({ ...activeFilter, left: null, right: null }); }} />
        {excluded.length > 0 && <IconButton icon="erase" label="Clear manual sprite exclusions" title={`Include all ${excluded.length} manually excluded sprites`} onClick={() => setExcluded([])}>{excluded.length}</IconButton>}
      </div>
      <p>{edgeError ? "Could not read edge counts. Sprites remain selectable." : "Outermost columns · right-click: include/exclude · all sprites stay clickable"}</p>
    </section>
        <button type="button" className={`atlas-no-fire${view.label === "no_fire" ? " saved" : ""}`} aria-label="Choose no fire" aria-pressed={candidate === "no_fire"} onClick={onNoFire} disabled={!onNoFire} title={previewOnly ? "Choose no fire for this image check" : `Choose no fire · X · Confirm/Enter saves it as reviewed${view.label === "no_fire" ? " · current saved label" : ""}`}>
          <span className="no-fire-art" aria-hidden="true">
            <span className="no-fire-sprite" style={{backgroundImage:`url(${fire0})`}} />
            <svg viewBox="0 0 16 16" className="no-fire-barrier" shapeRendering="crispEdges">
              <path fill="#e52b2b" fillRule="evenodd" d="M5 1h6v1h2v1h1v2h1v6h-1v2h-1v1h-2v1H5v-1H3v-1H2v-2H1V5h1V3h1V2h2ZM5 3v1H4v1H3v6h1v1h1v1h6v-1h1v-1h1V5h-1V4h-1V3Z" />
              <path fill="#ff3c32" d="M3 3h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v2h-2v-1h-1v-1H9v-1H8V9H7V8H6V7H5V6H4V5H3Z" />
            </svg>
          </span>
          <span>No fire</span>
        </button>
    </div>
    <div ref={pickerRef} className="picker picker-adaptive" style={{ "--cell": `${CELL}px`, "--blocks": blocks } as CSSProperties}>
      <div className="picker-blocks">
        {Array.from({ length: blocks }, (_, block) => (
          <div key={block} className="picker-block">
            <div className="picker-head">
              <div className="gutter" />
              <div className="group">Normal</div>
              <div className="group">Mirrored</div>
            </div>
            <div className="picker-head sheets">
              <div className="gutter" />
              {COLUMNS.map((_, c) => (
                <div key={c} className="sheet">
                  {columnHeader(c)?.sheet}
                </div>
              ))}
            </div>
            <div className="picker-rows">
              {Array.from({ length: rowsPerBlock }, (_, offset) => block * rowsPerBlock + offset).map((row) => (
                <div key={row} className="picker-row" ref={row === focusRow ? targetRef : undefined}>
                  <div className="gutter">{row}</div>
                  {COLUMNS.map((col, c) => {
                    const isCurrent = current?.col === c && current.row === row;
                    const isSug = sug.primary?.col === c && sug.primary.row === row;
                    const isAlt = sug.alt?.col === c && sug.alt.row === row;
                    const isChosen = chosen?.col === c && chosen.row === row;
                    const isShown = shown?.col === c && shown.row === row;
                    const counts = edges ? appearanceEdges(edges, col.sheet, row, col.mirrored) : null;
                    const id = appearanceId(col.sheet, row, col.mirrored);
                    const manualExcluded = excluded.includes(id);
                    const filteredOut = manualExcluded || (counts !== null && !matchesAppearance(edges, col.sheet, row, col.mirrored, activeFilter));
                    const states = [isChosen && "Candidate", isShown && "Preview", isSug && `Time guess from frame ${view.suggestion?.from_frame}`, isAlt && "Alternate time guess", isCurrent && "Saved label"].filter(Boolean);
                    const sheetImg = col.sheet === 0 ? fire0 : fire1;
                    return (
                      <button
                        key={c}
                        className={`cell${isCurrent ? " atlas-saved" : ""}${isSug ? " atlas-time" : ""}${isAlt ? " atlas-alt" : ""}${isChosen ? " atlas-candidate" : ""}${isShown ? " atlas-preview" : ""}${filteredOut ? " edge-filter-miss" : ""}${manualExcluded ? " manual-filter-miss" : ""}`}
                        aria-label={`row ${row}, sheet ${col.sheet}, ${col.mirrored ? "mirrored" : "normal"}${counts ? `; left ${counts.left}, right ${counts.right} edge pixels` : ""}${filteredOut ? "; outside filter, still selectable" : ""}${states.length ? `; ${states.join(", ")}` : ""}`}
                        aria-pressed={isChosen}
                        title={`row ${row} · sheet ${col.sheet} · ${col.mirrored ? "mirrored" : "normal"}${counts ? `\nEdge pixels: left ${counts.left} · right ${counts.right}` : ""}${filteredOut ? "\nOutside filter · still selectable" : ""}${states.length ? `\n${states.join(" · ")}` : ""}\n${previewOnly ? "Click: preview sprite" : "Click: select candidate · Ctrl+click: preview only"}`}
                        onClick={(e) => onCell(c, row, e.ctrlKey)}
                        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setExcluded(manualExcluded ? excluded.filter(value => value !== id) : [...excluded, id]); }}
                        tabIndex={-1}
                      >
                        <span
                          className="sprite"
                          style={{
                            backgroundImage: `url(${sheetImg})`,
                            backgroundSize: `${CELL}px ${CELL * ROWS}px`,
                            backgroundPosition: `0 -${row * CELL}px`,
                            transform: col.mirrored ? "scaleX(-1)" : undefined,
                          }}
                        />
                        <span className="atlas-badges" aria-hidden="true">
                          {manualExcluded && <span className="excluded-state" title="Manually excluded; right-click to include">×</span>}
                          {isShown && <span className="preview-state">P</span>}
                          {isChosen && <span className="candidate-state">C</span>}
                          {isSug && <span className="guess-state">T</span>}
                          {isAlt && <span className="guess-state">T?</span>}
                          {isCurrent && <span className="saved-state">✓</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  </>);
}
