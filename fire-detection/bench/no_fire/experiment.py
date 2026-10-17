"""One experiment/risk contract shared by research CLIs, reports and galleries."""
from html import escape
import sys

TITLE='EXPERIMENTAL · RISKY · MANUAL REVIEW REQUIRED'
WARNING=('This prototype can miss visible fire and can wrongly suggest no fire. '
         'A clear result is a candidate for review, never confirmation or proof. '
         'Do not automatically save labels, skip review, or infer a video is unedited.')
ASSUMPTIONS=(
 ('Use and integration',(
  'Experimental no-fire scanning is available in the desktop Automated tools popup. It returns review candidates only and never writes labels. First-person automation remains a separate tool in the same popup.',
  'Suggestions require a person to inspect the original frame and explicitly Confirm/Enter before a label is saved. Abstention, missing evidence and detector failure must remain unreviewed.',
  'A low colour score, no material hit, successful GUI fit or reconstructed image never proves absence of fire. This tool does not prove edits, lag or their absence.',
  'Known or suspected world translucency means abstain. Portal correction is inspection/post-processing only and never overrides that veto.',
  'Desktop Scan for no fire requires explicit vanilla-GUI confirmation and native1920x1080 footage. It decodes every indexed frame, supports cancellation and opens candidates in Label for manual confirmation. Scan results are held in memory and not restored after app restart.',
  'Desktop integration adds conservative abstention when no reliable HUD is found or automatic unveil fails with a menu-like share>=.80. These guards were added after checking the known156s pause failure; historical69/3 and held-out5/1 counts do not measure this stricter desktop policy.',
 )),
 ('Footage and rendering',(
  'Assumes vanilla Minecraft Java 1.16.5 visuals and matching locally supplied textures. Resource packs, shaders, mods that alter GUI/rendering, recoloured or soul fire, and other versions are not validated.',
  'Assumes the uncropped, unrotated, unwarped game viewport. Letterboxing, subtitles burned into footage, edits/resizing, unusual GUI changes and overlaid streaming graphics can invalidate geometry or colour rules.',
  'Benchmarks use native 1920x1080 RGB frames at 60 video frames per second. Pixel-count thresholds are not resolution invariant; do not apply them unchanged to other resolutions, display zoom, upscaled or heavily compressed footage.',
  'Frame seeking in the research pilots uses CFR 60-fps frame/60 timestamps. Variable frame rate, missing timestamps, reordered frames or different capture rate need verified frame mapping; video frames are not 20-Hz game ticks.',
  'Decoded RGB24 is treated as ordinary 8-bit RGB. HDR/tonemapping, gamma changes, colour grading, heavy encoding, blur, darkness, fog, underwater tint, hurt flashes and particles can shift or hide fire colours.',
  'Local game assets, recordings, labels, generated binaries and caches are not redistributable project source. Asset rights and platform packaging are separate from detector validation.',
 )),
 ('Fire evidence and small-fire cutoff',(
  'Positive in no-fire evaluation means a correct clear. False positive means meaningful fire wrongly cleared. In material detection, positive instead means detected target translucency; report these tasks separately.',
  'The baseline uses orange pixels only: R>=64, .23R<=G<=.88R, B<=.5R and R-B>=24. It joins nearby fragments with radius4, counts original orange area rather than dilated area, and proposes clear below2198.',
  'Raw and shared automatic-unveil evidence are combined conservatively. White/grey pixels are not independent fire evidence. The top12 native rows are excluded for the capture strip; fire visible only there can be missed.',
  'The extra small-fire veto applies only to restored RGB after confirmed automatic menu unveil: 8-connected strong-orange area>=128, width>=24, height>=8; R>=96, .30R<=G<=.85R, B<=.25R, R-B>=80.',
  'The extra veto means possible fire OR uncovered GUI, not a positive fire label. It deliberately retains some warm opaque objects and GUI icons; warm surroundings can also prevent useful clears.',
  'Historical substantial-fire truth uses a 24-native-pixel horizontal visible-box proxy with no height cutoff. This is not a proven sprite-readability threshold and is not equivalent to eight distinguishable sprite pixels.',
  'The owner permits negligible/unlabelable tiny fire to pass, but only specific reviewed cases were accepted. There is no validated universal compression/size cutoff: do not silently discard all small or partly occluded flames.',
 )),
 ('Automatic unveil and portal recovery',(
  'Menu inverse assumes the vanilla gradient tint(16,16,16), alpha192/255 at the top to208/255 at the bottom, with the shared Rust row interpolation/rounding/clamping. Pixel clipping and compression can destroy recoverable information.',
  'Menu judgment uses the canonical shared detector: outer20%/10% margins, share>=.90 and channel slack2, GUI-neutral rules, background quorum and true-black rejection. It can reject real menus or accept a confusing dark scene.',
  'All automatic menu detection/inverse comes from core/src/veil.rs. Native, Python and WASM must share it; no forced inverse may be silently substituted for a failed automatic judgment.',
  'Portal inverse assumes the local vanilla 32-phase16x16 RGBA atlas stretched over the full viewport with ordinary alpha blending. It fits phase/opacity using texture-boundary continuity, not fire labels.',
  'Portal fits are heuristic: original gate opacity>=.1, purple share>=.2 and residual improvement>=.35. Compression, blur, non-vanilla animation and underlying image structure can confuse the fit.',
  'Low-transmittance or inconsistent pixels remain unchanged with validity zero. Recovery can amplify noise and leave grid seams. Fullscreen undo does not remove a world-space portal block or reconstruct arbitrary glass/water.',
 )),
 ('Translucent-material veto',(
  'The material detector proposes suspected portal/purple effects and textured blue water/blue tinted glass. It cannot infer arbitrary alpha from a finished RGB frame; absence of a hit is not proof of opacity.',
  'V3 samples every3 native pixels and examines16x16 sampled patches (48x48 native). Portal support requires purple share>=.12 and texture deviation>=5. Small materials can fall below the region threshold.',
  'Blue candidates require B>=42, B>1.20R, B>1.30G and G>1.12R. Patches require blue share>=.65, texture deviation>=4, internal edge share>=.08 above a5-level difference and neighbouring qualifying support.',
  'Portal candidates use B>=95, R>=55, R>1.5G, B>1.15R and B>1.65G. Opaque purple materials and enchanted tools can still trigger false abstentions.',
  'Colourless glass, other glass colours, ice, arbitrary water colours, all particles, weather and every translucent render pass are not covered. The requested any-translucency policy is broader than this implementation.',
  'The older shared portal_guard is a different conservative purple-candidate guard (>=64 connected pixels or a supplied known-translucent mask), not the V3 material detector. Their thresholds/results must not be conflated.',
 )),
 ('GUI mask and uncertainty',(
  'GUI analysis requires explicit confirmation of vanilla1.16.5, uncropped, normally scaled footage. The canonical Rust gui_mask uses local widgets/icons/inventory/bars/ascii atlases and default options; missing extras reduce coverage.',
  'A reliable GUI result confirms a hotbar/scale anchor, not complete GUI coverage. No reliable fit means unavailable information, never no GUI.',
  'The current masker covers in-game HUD pieces, not open inventory, creative panels, pause screens or every menu. Unlabelled areas of an open screen cannot be certified as world.',
  'Known opaque/translucent GUI is excluded from material evidence. Unknown hotbar-item/effect-icon/crosshair interiors remain GUI; ambiguous edge slivers remain eligible. Full piece IDs must be preserved rather than truncated to four bits.',
  'Translucent GUI still contains world pixels. Excluding its colour evidence does not prove no fire behind it. Held objects, enchanted glint and unsupported screens can remain confounders.',
  'GUI masking was added to the material veto while the baseline fire scores stayed fixed. This is not a recalibrated full GUI-masked no-fire model, nor a perfect GUI oracle.',
 )),
 ('Evidence, metrics and known failures',(
  'Original evaluation had1361 sampled frames across three recordings (755 clear-eligible,606 substantial-fire by the historical proxy); baseline91TP/13FP. Subsequent veto comparisons re-evaluate its104 clear candidates, not a new full-dataset detector.',
  'The final reviewed-cohort chain is91TP/13FP -> material+GUI70/4 -> restored-menu69/3. Those last3 were individually accepted as negligible by the owner; raw truth is preserved and raw FP is still3.',
  'The21 original correct clears vetoed by material analysis were manually reviewed as18water+3portal. This intentional loss follows the abstention policy; it is not evidence that all abstentions are correct.',
  'The58 material-development cases give29TP/0FN and4FP/25TN with actual GUI masking; GUI fit reliable53/58, and97/104 in the original-clear cohort. One opaque-control label includes held blue glass and is ambiguous; it was not silently relabelled.',
  'The material cohort and original clear cohort were used to refine thresholds/rules. Repeated trials, adjacent frames and the same local setup are correlated; these are development results, not independent accuracy estimates.',
  'The frozen extra-rule check sampled107 frames every2s across two separate recordings. Six clears were reviewed as5visually no-fire and1unsafe pause-menu case conservatively counted asFP;3TPs were loading/saving screens, only2 ordinary gameplay.',
  'Sampling every2s or90frames misses intervening events. Six independent-test clear outputs are insufficient for an accuracy guarantee, and these recordings do not cover other creators, versions or compression pipelines.',
  'Recorded geometry/visibility truth is approximate. Capture labels, sampled fire boxes and human readability judgments are different evidence sources; missing, rejected or unknown masks never mean no fire.',
  'Known remaining risks include an unsafe pause-menu clear where automatic unveil share.882 fails the.90 gate, and a creative-inventory campfire icon causing false retention. Open-screen handling remains incomplete.',
  'No zero-error, all-translucency, perfect-GUI, calibrated probability, frame-complete validation, or forensic-proof claim is supported. Revalidate after changing preprocessing, thresholds, resolution, assets or GUI defaults; retain source hashes and earlier results.',
 )),
)

def metadata():
    return {'status':'experimental_risky','requires_manual_review':True,'can_auto_confirm':False,
            'warning':WARNING,'assumptions_version':2,
            'assumptions':[{'topic':topic,'items':list(items)} for topic,items in ASSUMPTIONS]}

def announce():
    print(TITLE+'\n'+WARNING+'\nAssumptions: fire-detection/bench/no_fire/EXPERIMENTAL-ASSUMPTIONS.md',file=sys.stderr,flush=True)

def html_notice():
    sections=''.join('<h3>'+escape(topic)+'</h3><ul>'+''.join('<li>'+escape(s)+'</li>' for s in items)+'</ul>' for topic,items in ASSUMPTIONS)
    return ('<aside role="note" style="border:2px solid #f6ad55;padding:16px;background:#30251b;color:#fff;margin:16px 0">'
            '<strong>'+escape(TITLE)+'</strong><p>'+escape(WARNING)+'</p>'
            '<details><summary>All assumptions and known limits</summary>'+sections+'</details></aside>')

def markdown():
    lines=['# '+TITLE,'',WARNING,'','This is the canonical contract for the no-fire/translucency research preview. Generated from `experiment.py`; update that source to keep CLI/report/gallery text aligned.','']
    for topic,items in ASSUMPTIONS:
        lines+=['## '+topic,'']+['- '+s for s in items]+['']
    return '\n'.join(lines)

if __name__=='__main__':
    import argparse,json
    from pathlib import Path
    parser=argparse.ArgumentParser(description='Generate the shared experiment warning and complete assumptions for docs and the app.')
    parser.add_argument('--write-contract',action='store_true')
    args=parser.parse_args()
    if args.write_contract:
        here=Path(__file__).parent;root=here.parents[2]
        (here/'EXPERIMENTAL-ASSUMPTIONS.md').write_text(markdown(),encoding='utf8')
        (root/'FireCrackle/src/lib/noFireExperiment.json').write_text(__import__('json').dumps(metadata(),indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    else:print(markdown())
