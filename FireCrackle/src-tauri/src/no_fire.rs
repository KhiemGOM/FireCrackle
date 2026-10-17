//! Experimental candidate scan. No labels are written; every result needs review.
//! Orange and retention rules are the frozen research implementations, included directly.
#[path = "../../../fire-detection/bench/no_fire/fragment_rules.rs"]
#[allow(dead_code)]
mod fragments;
#[path = "../../../fire-detection/bench/no_fire/retention_rules.rs"]
#[allow(dead_code)]
mod retention;
use fire_core::{gui_mask::{detect_gui, GuiOptions, GuiTextures}, veil::{detect_pixels, Options, unveil_rgb}};
use std::{process::Child, sync::{Mutex, atomic::AtomicBool}};
use studio_core::{import::Tools, project::Project};

fn textures() -> Result<GuiTextures, String> {
    macro_rules! asset { ($name:literal) => { include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../fire-detection/data/assets/gui/", $name)).to_vec() }; }
    GuiTextures::from_rgba(asset!("widgets.rgba"), asset!("icons.rgba"), asset!("inventory.rgba"))?
        .with_extras(Some(asset!("bars.rgba")), Some(asset!("ascii.rgba")))
}

pub(crate) fn scan(project: &Project, tools: &Tools, cancel: &AtomicBool, slot: &Mutex<Option<Child>>,
    update: impl FnMut(u32, Option<u8>)) -> Result<(), String> {
    let tex = textures()?;
    let (w,h) = (project.meta.width, project.meta.height);
    crate::pov::scan_with(project, tools, cancel, slot, |rgb| {
        candidate(rgb, w, h, &tex).map(|clear| clear.then_some(0))
    }, update)
}

fn candidate(rgb: &[u8], w: usize, h: usize, tex: &GuiTextures) -> Result<bool, String> {
    let raw = fragments::mask(rgb,w,h);
    if fragments::largest(&raw,w,h,4) >= 2198 { return Ok(false); }
    let (used,share) = detect_pixels(rgb,w,h,3,12,Options::default())?;
    // Weak menu-like tint is unresolved occlusion, not permission to clear.
    // In particular the independent156s pause example scores .882 and failed the .90 unveil gate.
    if !used && share>=0.80 { return Ok(false); }
    let fixed = if used { unveil_rgb(rgb,w,h)? } else { rgb.to_vec() };
    if used && fragments::largest(&fragments::mask(&fixed,w,h),w,h,4) >= 2198 { return Ok(false); }
    let gui = detect_gui(rgb,w,h,tex,&GuiOptions::default())?;
    // Stricter than the development score: unavailable HUD is uncertainty, never a clearance.
    if !gui.reliable { return Ok(false); }
    let world: Vec<u8> = gui.class.iter().zip(&gui.piece).map(|(&class,&piece)|
        (!(class==1 || class==2 || [4,5,11].contains(&piece))) as u8).collect();
    if material(&fixed,&world,w,h) { return Ok(false); }
    if used && retention::components(&fixed,&world,w,h).iter().any(|c|
        c.0>=128 && c.3-c.1>=24 && c.4-c.2>=8) { return Ok(false); }
    Ok(true)
}

/// Material-patches-v3, matching translucency.py: sampled 48px patches, conservative veto.
fn material(rgb:&[u8], world:&[u8], w:usize, h:usize) -> bool {
    let (sw,sh)=(w.div_ceil(3),h.div_ceil(3));
    let mut blue=vec![false;sw*sh];let mut purple=blue.clone();let mut lum=vec![0f64;sw*sh];
    for y in 0..sh { for x in 0..sw {
        let i=y*sw+x;let p=y*3*w+x*3;
        let (r,g,b)=(rgb[p*3] as f64,rgb[p*3+1] as f64,rgb[p*3+2] as f64);
        lum[i]=(r+g+b)/3.;
        if world[p]==0 {continue;}
        purple[i]=b>=95. && r>=55. && r>1.5*g && b>1.15*r && b>1.65*g;
        blue[i]=b>=42. && b>1.20*r && b>1.30*g && g>1.12*r;
    }}
    let (pw,ph)=(sw/16,sh/16);let mut tint=vec![false;pw*ph];
    for py in 0..ph {for px in 0..pw {
        let(mut bn,mut pn,mut en,mut sum,mut sq)=(0,0,0,0.,0.);
        for dy in 0..16 {for dx in 0..16 {
            let (x,y)=(px*16+dx,py*16+dy);let i=y*sw+x;let v=lum[i];
            sum+=v;sq+=v*v;bn+=blue[i] as usize;pn+=purple[i] as usize;
            let mut edge: f64=0.;
            if x>0 && blue[i] && blue[i-1] {edge=(v-lum[i-1]).abs();}
            if y>0 && blue[i] && blue[i-sw] {edge=edge.max((v-lum[i-sw]).abs());}
            en+=(edge>5.) as usize;
        }}
        let sd=(sq/256.-(sum/256.).powi(2)).max(0.).sqrt();
        if pn as f64/256.>=0.12 && sd>=5. {return true;}
        tint[py*pw+px]=bn as f64/256.>=0.65 && sd>=4. && en as f64/256.>=0.08;
    }}
    for y in 0..ph {for x in 0..pw {let i=y*pw+x;
        if tint[i] && ((x>0 && tint[i-1]) || (x+1<pw && tint[i+1]) ||
            (y>0 && tint[i-pw]) || (y+1<ph && tint[i+pw])) {return true;}
    }}
    false
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn blue_texture_and_portal_veto_but_flat_sky_does_not() {
        let w=96;let h=96;let world=vec![1;w*h];let mut rgb=vec![0;w*h*3];
        for c in rgb.chunks_exact_mut(3) {c.copy_from_slice(&[30,100,180]);}
        assert!(!material(&rgb,&world,w,h));
        for (i,c) in rgb.chunks_exact_mut(3).enumerate() { let d=if (i%w/3+i/w/3)%2==0 {0} else {25}; c.copy_from_slice(&[30+d,100+d,180+d]); }
        assert!(material(&rgb,&world,w,h));
        assert!(!material(&rgb,&vec![0;w*h],w,h));
        for (i,c) in rgb.chunks_exact_mut(3).enumerate() {let d=if (i%w/3+i/w/3)%2==0 {0} else {25};c.copy_from_slice(&[110+d,30+d,170+d]);}
        assert!(material(&rgb,&world,w,h));
    }
    #[test] fn missing_hud_never_clears_and_visible_orange_stays_reviewed() {
        let tex=textures().unwrap();let (w,h)=(1920,1080);let mut rgb=vec![0;w*h*3];
        assert!(!candidate(&rgb,w,h,&tex).unwrap());
        for y in 200..250 {for x in 200..250 {rgb[(y*w+x)*3..(y*w+x)*3+3].copy_from_slice(&[230,130,20]);}}
        assert!(!candidate(&rgb,w,h,&tex).unwrap());
    }
    #[test]
    #[ignore = "Requires native RGB frames extracted from the separate validation video"]
    fn real_video_candidates_and_pause_uncertainty() {
        let data=std::fs::read(std::env::var("NO_FIRE_SMOKE_RGB").unwrap()).unwrap();
        let bytes=1920*1080*3;assert_eq!(data.len(),bytes*3);
        let tex=textures().unwrap();
        let actual:Vec<_>=data.chunks_exact(bytes).map(|rgb|candidate(rgb,1920,1080,&tex).unwrap()).collect();
        assert_eq!(actual,vec![true,true,false],"32s / 40s gameplay clears; unsafe156s menu abstains");
    }
    #[test]
    #[ignore = "Requires lossless real-frame fixture and bundled FFmpeg"]
    fn desktop_scan_decodes_and_returns_reviewable_original_frames() {
        let video=std::env::var("NO_FIRE_SMOKE_VIDEO").unwrap();
        let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("runtime");
        let tools=Tools{ffmpeg:root.join("ffmpeg.exe").into_os_string(),ffprobe:root.join("ffprobe.exe").into_os_string()};
        let project=studio_core::import::import_video(&tools,std::path::Path::new(&video),&studio_core::config::Settings::default()).unwrap();
        assert_eq!(project.frames.len(),3);
        let jobs=crate::pov::Jobs::default();let initial=jobs.start_no_fire(project,tools).unwrap();
        let started=std::time::Instant::now();
        loop {
            let status=jobs.status().unwrap().unwrap();
            if status.state!="running" {
                assert_eq!(status.state,"done","{:?}",status.error);assert_eq!(status.processed,3);assert_eq!(status.accepted,2);
                assert_eq!(jobs.candidates(initial.id,0).unwrap(),vec![0,1]);break;
            }
            assert!(started.elapsed().as_secs()<30,"scan timed out");
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}
