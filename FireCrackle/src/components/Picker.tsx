import {useWaterTint} from "../hooks/useWaterTint";
import {renderWaterAtlases,type WaterAtlas} from "../lib/waterTint";
import {WaterTintControl} from "./WaterTintControl";
import {ANIMATION_ATLASES,atlasSource,atlasTile,type AnimationAtlas} from "../lib/animationAtlases";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import fire0 from "../assets/fire_0.png";
import fire1 from "../assets/fire_1.png";
import { COLUMNS, columnHeader, labelToCell, suggestionCells, type Label } from "../lib/grid";
import type { PreviewSprite } from "../lib/firePreview";
import type { View } from "../lib/api";
import { pickerLayout } from "../lib/pickerLayout";
import { appearanceEdges, appearanceId, edgeFilterValue, matchesAppearance, matchingAppearances, sheetEdgeCounts, spriteSheetEdgeCounts, type AtlasEdges, type EdgeFilter } from "../lib/atlasFilter";
import { Icon, IconButton } from "./Icon";
import "./Picker.css";

interface Props {
  onAlternative?: (sprite:PreviewSprite,ctrl:boolean)=>void;
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
export function Picker({ view, cell, onCell, candidate = null, preview = null, filter, onFilterChange, onNoFire, onEdgesChange, previewOnly = false, onAlternative }: Props) {
  const [atlasKind,setAtlasKind]=useState<"fire"|"soul_fire"|"lava"|"water">("fire");
  const atlasIds: [AnimationAtlas|null,AnimationAtlas|null] = atlasKind==='soul_fire'?['soul_fire_0','soul_fire_1']:atlasKind==='lava'?['lava_still','lava_flow']:atlasKind==='water'?['water_still','water_flow']:[null,null];
  const rows=Math.max(...atlasIds.map(id=>id?ANIMATION_ATLASES[id].rows:32));
  const maxPixels=Math.max(...atlasIds.map(id=>id?ANIMATION_ATLASES[id].side:16));
  const [familyFilters,setFamilyFilters]=useState<Partial<Record<typeof atlasKind,EdgeFilter>>>({});
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [localLeft, setLocalLeft] = useState<number | null>(null);
  const [localRight, setLocalRight] = useState<number | null>(null);
  const [localExcluded, setLocalExcluded] = useState<number[]>([]);
  const [localWhiteMin, setLocalWhiteMin] = useState<number | null>(null);
  const [localWhiteMax, setLocalWhiteMax] = useState<number | null>(null);
  const fireFilter=filter??{left:localLeft,right:localRight,excluded:localExcluded,bottomWhiteMin:localWhiteMin,bottomWhiteMax:localWhiteMax};
  const activeFilter=atlasKind==='fire'?fireFilter:familyFilters[atlasKind]??{left:null,right:null};
  const {left,right}=activeFilter,excluded=activeFilter.excluded??[],bottomWhiteMin=activeFilter.bottomWhiteMin??null,bottomWhiteMax=activeFilter.bottomWhiteMax??null;
  const updateFilter=(next:EdgeFilter)=>{if(atlasKind==='fire')onFilterChange?.(next);else setFamilyFilters(previous=>({...previous,[atlasKind]:next}));};
  const setLeft=(value:number|null)=>{if(atlasKind==='fire')setLocalLeft(value);updateFilter({...activeFilter,left:value});};
  const setRight=(value:number|null)=>{if(atlasKind==='fire')setLocalRight(value);updateFilter({...activeFilter,right:value});};
  const setExcluded=(value:number[])=>{if(atlasKind==='fire')setLocalExcluded(value);updateFilter({...activeFilter,excluded:value});};
  const setWhiteMin=(value:number|null)=>{if(atlasKind==='fire')setLocalWhiteMin(value);updateFilter({...activeFilter,bottomWhiteMin:value});};
  const setWhiteMax=(value:number|null)=>{if(atlasKind==='fire')setLocalWhiteMax(value);updateFilter({...activeFilter,bottomWhiteMax:value});};
  const [edges, setEdges] = useState<AtlasEdges | null>(null);
  const [edgeError, setEdgeError] = useState(false);
  const water=useWaterTint(atlasKind==="water");
  useEffect(() => { onEdgesChange?.(atlasKind==='fire'?edges:null); }, [edges, onEdgesChange,atlasKind]);
  useEffect(() => {
    let cancelled = false;setEdges(null);setEdgeError(false);
    const load = (src: string,atlas:AnimationAtlas|null) => new Promise<ReturnType<typeof sheetEdgeCounts>>((resolve, reject) => {
      if(atlas==="water_still"||atlas==="water_flow"){void renderWaterAtlases(water.color).then(sheets=>{const sheet=sheets[atlas];resolve(spriteSheetEdgeCounts(sheet.rgba,sheet.width,ANIMATION_ATLASES[atlas].rows));}).catch(reject);return;}
      const image = new Image();
      image.onload = () => {
        try {
          const side=atlas?ANIMATION_ATLASES[atlas].side:16,count=atlas?ANIMATION_ATLASES[atlas].rows:32;
          if (image.naturalWidth !== side || image.naturalHeight !== side*count) throw new Error("Invalid fire sprite sheet");
          const canvas = document.createElement("canvas"); canvas.width = side; canvas.height = side*count;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas unavailable");
          ctx.drawImage(image, 0, 0);
          const counts=spriteSheetEdgeCounts(ctx.getImageData(0, 0, side, side*count).data,side,count);
          resolve(atlas?Array.from({length:count},(_,row)=>counts[atlasTile(atlas,row)]):counts);
        } catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error("Could not load fire pixels"));
      image.src = src;
    });
    void Promise.all(atlasIds.map((atlas,i)=>load(atlas?atlasSource(atlas):i===0?fire0:fire1,atlas))).then((counts) => { if (!cancelled) setEdges(counts as AtlasEdges); }).catch(() => { if (!cancelled) setEdgeError(true); });
    return () => { cancelled = true; };
  }, [atlasKind,water.color]);
  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(picker);
    return () => observer.disconnect();
  }, []);
  const { blocks, rowsPerBlock, cell: CELL } = pickerLayout(size.width, size.height, cell,rows);
  const cellFor=(label:Label)=>{
    if(typeof label==='object'&&'texture' in label){const sheet=atlasIds.indexOf(label.texture.atlas);return sheet<0?null:{col:sheet+(label.texture.mirrored?2:0),row:label.texture.row};}
    return atlasKind==='fire'?labelToCell(label):null;
  };
  const current = cellFor(view.label);
  const chosen = candidate ? cellFor(candidate) : null;
  const shown = preview ? cellFor(preview.atlas?{texture:{atlas:preview.atlas,row:preview.row,mirrored:preview.mirrored}}:{fire:preview}) : null;
  const sug = view.suggestion && (atlasKind==='fire'||atlasKind==='soul_fire') ? suggestionCells(view.suggestion) : { primary: null, alt: null };
  const targetRef = useRef<HTMLDivElement | null>(null);

  const focusRow = chosen?.row ?? shown?.row ?? sug.primary?.row ?? current?.row ?? null;
  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusRow, blocks, CELL]);

  const filterActive = left !== null || right !== null || bottomWhiteMin !== null || bottomWhiteMax !== null;
  const invalidWhiteRange = bottomWhiteMin !== null && bottomWhiteMax !== null && bottomWhiteMin > bottomWhiteMax;
  const atlasTabs=<div className="atlas-tabs" role="group" aria-label="Animation atlas">{([['fire','Fire'],['soul_fire','Soul fire'],['lava','Lava'],['water','Water']] as const).map(([id,name])=><button key={id} aria-pressed={atlasKind===id} onClick={()=>setAtlasKind(id)}>{name}</button>)}</div>;
  return (<>{atlasTabs}
    {atlasKind==="water"&&<WaterTintControl color={water.color} onChange={water.setColor}/>}
    <div className="atlas-options" onKeyDown={(e) => e.stopPropagation()}>
    <section className="atlas-filters" aria-label="Visual sprite filters">
      <div className="atlas-filter-heading"><Icon name="filter" /><strong>Sprite pixels</strong><span role="status">{edgeError ? "Counts unavailable" : edges ? `${matchingAppearances(edges, activeFilter)} / ${edges.reduce((n,sheet)=>n+sheet.length*2,0)} match` : "Reading pixels…"}</span></div>
      <div className="atlas-filter-inputs">
        <label>Left <input type="number" min={0} max={maxPixels} step={1} placeholder="Any" aria-label="Left edge fire pixels" value={left ?? ""} onChange={(e) => setLeft(edgeFilterValue(e.target.value,maxPixels))} /></label>
        <label>Right <input type="number" min={0} max={maxPixels} step={1} placeholder="Any" aria-label="Right edge fire pixels" value={right ?? ""} onChange={(e) => setRight(edgeFilterValue(e.target.value,maxPixels))} /></label>
        <IconButton icon="reset" label="Clear sprite pixel filters" disabled={!filterActive} onClick={() => { setLocalLeft(null); setLocalRight(null); setLocalWhiteMin(null); setLocalWhiteMax(null); updateFilter({ ...activeFilter, left: null, right: null, bottomWhiteMin: null, bottomWhiteMax: null }); }} />
        {excluded.length > 0 && <IconButton icon="erase" label="Clear manual sprite exclusions" title={`Include all ${excluded.length} manually excluded sprites`} onClick={() => setExcluded([])}>{excluded.length}</IconButton>}
      </div>
      <div className="atlas-filter-inputs" role="group" aria-label="Bottom white inclusive range" title="Total white and near-white pixels across the entire bottom row, adding every separate patch. Enter a range to allow for cream pixels or uncertain footage. Near-white includes RGB channels 245–255. Both bounds are inclusive; blank means no bound.">
        <span>Bottom white</span>
        <label>Min <input type="number" min={0} max={maxPixels} step={1} placeholder="Any" aria-label="Minimum bottom white pixels" aria-invalid={invalidWhiteRange || undefined} value={bottomWhiteMin ?? ""} onChange={e => setWhiteMin(edgeFilterValue(e.target.value,maxPixels))} /></label>
        <label>Max <input type="number" min={0} max={maxPixels} step={1} placeholder="Any" aria-label="Maximum bottom white pixels" aria-invalid={invalidWhiteRange || undefined} value={bottomWhiteMax ?? ""} onChange={e => setWhiteMax(edgeFilterValue(e.target.value,maxPixels))} /></label>
      </div>
      {invalidWhiteRange && <p role="alert">Bottom white: Min must be no greater than Max.</p>}
      <p>{edgeError ? "Could not read pixel counts. Sprites remain selectable." : "Bottom white: total, min–max inclusive · right-click: include/exclude · all sprites stay clickable"}</p>
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
              {Array.from({ length: rowsPerBlock }, (_, offset) => block * rowsPerBlock + offset).filter(row=>row<rows).map((row) => (
                <div key={row} className="picker-row" ref={row === focusRow ? targetRef : undefined}>
                  <div className="gutter">{row}</div>
                  {COLUMNS.map((col, c) => {
                    const atlas=atlasIds[col.sheet],count=atlas?ANIMATION_ATLASES[atlas].rows:32;
                    if(row>=count)return <span className="cell" key={c} aria-hidden="true"/>;
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
                    const sheetImg = atlas==="water_still"||atlas==="water_flow"?water.sheets?.[atlas as WaterAtlas].url??(water.color==="#ffffff"?atlasSource(atlas):""):atlas?atlasSource(atlas):col.sheet === 0 ? fire0 : fire1;
                    return (
                      <button
                        key={c}
                        className={`cell${isCurrent ? " atlas-saved" : ""}${isSug ? " atlas-time" : ""}${isAlt ? " atlas-alt" : ""}${isChosen ? " atlas-candidate" : ""}${isShown ? " atlas-preview" : ""}${filteredOut ? " edge-filter-miss" : ""}${manualExcluded ? " manual-filter-miss" : ""}`}
                        aria-label={`row ${row}, sheet ${col.sheet}, ${col.mirrored ? "mirrored" : "normal"}${counts ? `; left ${counts.left}, right ${counts.right} edge pixels` : ""}${filteredOut ? "; outside filter, still selectable" : ""}${states.length ? `; ${states.join(", ")}` : ""}`}
                        aria-pressed={isChosen}
                        title={`row ${row} · sheet ${col.sheet} · ${col.mirrored ? "mirrored" : "normal"}${counts ? `\nEdge pixels: left ${counts.left} · right ${counts.right} · bottom white ${counts.bottomWhite ?? "unknown"}` : ""}${filteredOut ? "\nOutside filter · still selectable" : ""}${states.length ? `\n${states.join(" · ")}` : ""}\n${previewOnly ? "Click: preview sprite" : "Click: select candidate · Ctrl+click: preview only"}\nRight-click: ${manualExcluded ? "restore candidate" : "mark as non-candidate"}`}
                        onClick={(e) => atlas?onAlternative?.({atlas,sheet:col.sheet,row,mirrored:col.mirrored},e.ctrlKey):onCell(c,row,e.ctrlKey)}
                        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setExcluded(manualExcluded ? excluded.filter(value => value !== id) : [...excluded, id]); }}
                        tabIndex={-1}
                      >
                        <span
                          className="sprite"
                          style={{
                            backgroundImage: sheetImg?`url(${sheetImg})`:"none",
                            backgroundSize: `${CELL}px ${CELL * count}px`,
                            backgroundPosition: `0 -${(atlas?atlasTile(atlas,row):row) * CELL}px`,
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
