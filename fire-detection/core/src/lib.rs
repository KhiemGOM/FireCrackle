//! Sync strip codec and the tools around it. See `sync/PLAN.md` for the exact formats.
#![allow(clippy::chunks_exact_to_as_chunks)] // slice chunking by 3 over runtime-length buffers; as_chunks would not be clearer

pub mod detect;
pub mod eval;
pub mod features;
pub mod flicker;
pub mod gui_interaction;
pub mod gui_mask;
pub mod json;
pub mod labels;
pub mod overlay;
pub mod patch;
pub mod pov;
pub mod presence;
pub mod profile;
pub mod report;
pub mod sync;
pub mod veil;
pub mod video;
pub mod yuv;
