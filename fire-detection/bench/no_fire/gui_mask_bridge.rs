//! Thin research ABI for the canonical GUI implementation; no GUI rules copied.
#[path = "../../core/src/gui_mask.rs"]
#[allow(dead_code)]
mod gui;
use std::ffi::CStr;
use std::sync::OnceLock;
static TEXTURES: OnceLock<Result<gui::GuiTextures,String>> = OnceLock::new();

/// Caller supplies valid RGB24/output buffers and a NUL-terminated local asset directory.
#[no_mangle]
pub unsafe extern "C" fn research_gui_mask(p:*const u8,len:usize,w:usize,h:usize,dir:*const std::ffi::c_char,out:*mut u8,meta:*mut f64)->i32 {
 if p.is_null()||out.is_null()||meta.is_null()||dir.is_null()||w.checked_mul(h).and_then(|n|n.checked_mul(3))!=Some(len){return -1;}
 let path=match CStr::from_ptr(dir).to_str(){Ok(x)=>x,Err(_)=>return -2};
 let tex=match TEXTURES.get_or_init(||gui::GuiTextures::load(std::path::Path::new(path))){Ok(t)=>t,Err(_)=>return -3};
 let rgb=std::slice::from_raw_parts(p,len);
 let m=match gui::detect_gui(rgb,w,h,tex,&gui::GuiOptions::default()){Ok(m)=>m,Err(_)=>return -4};
 // Keep full piece ids: later GUI pieces exceed 15 and cannot fit a nibble.
 let dst=std::slice::from_raw_parts_mut(out,w*h*2);
 dst[..w*h].copy_from_slice(&m.class);dst[w*h..].copy_from_slice(&m.piece);
 let info=std::slice::from_raw_parts_mut(meta,3);
 info[0]=if m.reliable {1.}else{0.};info[1]=m.fit.map_or(0.,|f|f.scale);info[2]=m.hits.len() as f64;
 0
}
