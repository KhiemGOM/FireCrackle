export function ChartLegend({kind,canonical=false,ruler=false}:{kind:'phase'|'row'|'jolt'|'agreement';canonical?:boolean;ruler?:boolean}){
  return <div className="chart-legend" aria-label={`${kind} chart legend`}>
    {kind==='jolt'?<><span><i className="dot lime"/>Observed Jolt reading</span><span><i className="line blue"/>Fit within a Jolt section</span></>:kind==='agreement'?<><span><i className="dot green"/>Fire at an observed Jolt reading</span><span><i className="line dashed blue"/>Fire with estimated Jolt clock</span></>:<><span><i className={`dot ${ruler?'green':'blue'}`}/>{kind==='row'?'Labelled animation row':'Labelled fire timing offset'}</span>{kind==='row'?<span>Rows 0–31 repeat each cycle</span>:<span><i className="line green"/>Zero = initial clock relationship</span>}</>}
    <span><i className="band red"/>Hard review event</span><span><i className="band amber"/>Soft review event</span>
    <span><i className="band violet"/>Jolt report flag · separate from hard/soft fire flags</span>
    <span><i className="band uncertain"/>Dashed bounds = uncertain event location</span>
    {canonical&&<span><i className="band amber"/>Yellow gap = unresolved Jolt clock; no fire timing plotted</span>}
    {(kind==='phase'||kind==='row')&&!canonical&&<span><i className="band gray"/>Shaded/dashed gaps = missing fire evidence</span>}
    {ruler&&<span><i className="line white"/>Perfect-clock ruler · green / amber / red = distance from ruler</span>}
  </div>;
}
