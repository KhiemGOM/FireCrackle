//! FireCrackle core logic: settings, label store, frame index, project file and phase analysis (no UI).
//!
//! FireCrackle assumes the footage has NO sync strip: ticks are estimated from video timestamps.
//! The phase rules and their Yarn-source evidence are in `docs/PHASE-EVIDENCE.md` (E7 for the no-strip case);
//! do not change them without re-reading it. The design is in `docs/PLAN.md` and `docs/PLAN-M1.md`.

pub mod autosave;
pub mod chart;
pub mod config;
pub mod decode_gate;
pub mod decode_plan;
pub mod frames;
pub mod fsutil;
pub mod gui;
pub mod import;
pub mod index;
pub mod install_kind;
pub mod label;
pub mod lane;
pub mod phase;
pub mod phase_compare;
pub mod phase_v2;
pub mod proc;
pub mod project;
pub mod session;
pub mod thumbs;
pub mod workspace;
