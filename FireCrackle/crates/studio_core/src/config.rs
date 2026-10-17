//! Every tunable threshold in one place, each with a default, a valid range and a plain-language
//! explanation (`Settings::describe`), so a settings screen can be generated from it and nothing is a
//! hidden constant. Older settings files keep working: missing fields fall back to their defaults.
//!

use crate::phase::Config as PhaseConfig;
use serde::{Deserialize, Serialize};

/// Experimental phase comparison controls, separate from shipped settings until validated.
/// All thresholds are explicit here and serialised in comparison reports.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PhaseResearchConfig {
    /// Expected ticks per video second. Positive and finite; never automatically replaced by a fitted rate.
    pub tick_rate: f64,
    /// Time-bin width in seconds (>0). One circular mean per occupied bin avoids counting duplicate frames
    /// as independent measurements. PELT is exact on these bins, not on all original observations.
    pub bin_seconds: f64,
    /// PELT change penalty and PCID pre-screen gain, in circular tick-squared units (>=0).
    pub penalty_ticks2: f64,
    /// Smallest segment-level offset reported as an event, in ticks (0..16).
    pub min_change_ticks: f64,
    /// Largest difference between departure's before/after levels to call it recovered (0..16 ticks).
    pub recovery_ticks: f64,
    /// Longest departure grouped as a recovered event, in video seconds (>0).
    pub recovery_seconds: f64,
    /// A row held longer than this is a held-animation event (>0 seconds), not proof of a frozen picture.
    pub held_seconds: f64,
    /// Largest observation gap across which held animation can be asserted (>0 seconds).
    pub held_max_gap_seconds: f64,
    /// PCID interval expansion in occupied bins (>0), chosen below the shortest change spacing of interest.
    pub expansion_bins: usize,
    /// PCID bounded analysis-window size in bins (>=2); a second overlapping tiling covers window edges.
    pub pcid_window_bins: usize,
    /// Block-permutation replicates (>0). Minimum attainable p-value is 1/(B+1).
    pub permutations: usize,
    /// Bins per shuffled block (>0), retaining short-range dependence; no calibrated video-wide error claim.
    pub permutation_block_bins: usize,
    /// Exploratory PCID per-test significance in (0,1). Multiple adaptive tests are not globally calibrated.
    pub alpha: f64,
    /// Reproducible randomisation seed; nonzero after internal mixing.
    pub seed: u64,
    /// Half-width of diagnostic rate search around nominal, ticks/second (>0).
    pub rate_search: f64,
    /// Diagnostic rate grid spacing (>0, <=rate_search); reported fit never changes the detector clock.
    pub rate_step: f64,
    /// Quantile of wrapped clock residual used for a lower-edge diagnostic (0..1).
    pub edge_quantile: f64,
    /// First occupied time bins used to anchor the common clock (>0). Circular median resists isolated
    /// startup outliers; the reference never follows later observations or resets across gaps.
    pub clock_anchor_bins: usize,
}
impl Default for PhaseResearchConfig {
    fn default() -> Self {
        Self {
            tick_rate: 20.0,
            bin_seconds: 0.5,
            penalty_ticks2: 5.0,
            min_change_ticks: 0.75,
            recovery_ticks: 0.75,
            recovery_seconds: 60.0,
            held_seconds: 0.25,
            held_max_gap_seconds: 0.1,
            expansion_bins: 16,
            pcid_window_bins: 256,
            permutations: 199,
            permutation_block_bins: 2,
            alpha: 0.05,
            seed: 1,
            rate_search: 0.05,
            rate_step: 0.0005,
            edge_quantile: 0.1,
            clock_anchor_bins: 8,
        }
    }
}

/// Combined-checker controls. Every field is exposed and range-checked by Settings::describe/set.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PhaseV2Config {
    /// Occupied time-bin width for PELT (seconds); raw checks still inspect every label.
    pub bin_seconds: f64,
    /// Cost per extra PELT segment in circular tick-squared units.
    pub penalty_ticks2: f64,
    /// Early occupied bins anchoring the common circular-median clock reference.
    pub anchor_bins: usize,
    /// Contiguous same-row duration that supplies held-animation evidence (seconds).
    pub held_seconds: f64,
    /// Largest timestamp gap allowed inside a held-animation interval (seconds).
    pub held_max_gap_seconds: f64,
    /// Observations on EACH side needed to assess recovery; missing evidence leaves it unknown.
    pub recovery_samples: usize,
    /// Allowed difference of before/after clock-residual centres (ticks).
    pub recovery_ticks: f64,
    /// Minimum PELT supplement size (ticks); phase.min_shift_ticks may raise it.
    pub supplement_min_ticks: f64,
}
impl Default for PhaseV2Config {
    fn default() -> Self {
        Self {
            bin_seconds: 0.5,
            penalty_ticks2: 5.0,
            anchor_bins: 8,
            held_seconds: 0.25,
            held_max_gap_seconds: 0.1,
            recovery_samples: 6,
            recovery_ticks: 0.75,
            supplement_min_ticks: 0.75,
        }
    }
}

/// How the frame index judges timing regularity.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct IndexConfig {
    /// An interval between frames counts as irregular when it differs from the median interval by more
    /// than this fraction of the median.
    pub irregular_deviation: f64,
    /// The video is called variable frame rate when more than this fraction of intervals is irregular.
    pub vfr_fraction: f64,
}

impl Default for IndexConfig {
    fn default() -> IndexConfig {
        IndexConfig {
            irregular_deviation: 0.5,
            vfr_fraction: 0.01,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProjectConfig {
    /// How many bytes at the start and at the end of the video go into its fingerprint.
    pub fingerprint_window_bytes: u64,
}

impl Default for ProjectConfig {
    fn default() -> ProjectConfig {
        ProjectConfig {
            fingerprint_window_bytes: 1 << 20,
        }
    }
}

/// How labelling behaves in the Label tab.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct LabelConfig {
    /// Frames to move forward after a label is set (0 = stay on the frame).
    pub advance_frames: u32,
    /// Frames moved by the big-step keys.
    pub big_step_frames: u32,
    /// After labelling, jump to the next unlabelled frame instead of moving by `advance_frames`.
    pub advance_to_unlabelled: bool,
    /// A single typed row digit that could start a two-digit row is committed after this long.
    pub row_type_timeout_ms: u32,
    /// No row suggestion further than this many seconds from the nearest labelled fire frame.
    pub suggest_max_seconds: f64,
    /// Neighbouring trusted labels used to constrain fractional clock phase.
    pub suggest_calibration_seconds: f64,
    /// Timing uncertainty around the target, measured in local indexed frame intervals.
    pub suggest_capture_frames: f64,
    /// Fastest playback with the J/L shuttle keys, as a multiple of the video's frame rate.
    pub max_play_speed: u32,
    /// Shortest time between two playback steps in milliseconds; faster playback steps several frames at once.
    pub min_play_tick_ms: u32,
    /// Veil undo: share of the judged pixels that must look veiled for a frame to count as veiled.
    pub veil_min_share: f64,
    /// Veil undo: width of the left and right margins that are judged, as a share of the frame width.
    pub veil_margin: f64,
    /// Veil undo: levels of tolerance at both ends of the legal veiled range.
    pub veil_slack: f64,
}

impl Default for LabelConfig {
    fn default() -> LabelConfig {
        LabelConfig {
            advance_frames: 1,
            big_step_frames: 10,
            advance_to_unlabelled: false,
            row_type_timeout_ms: 700,
            suggest_max_seconds: 30.0,
            suggest_calibration_seconds: 2.0,
            suggest_capture_frames: 0.5,
            max_play_speed: 8,
            min_play_tick_ms: 16,
            veil_min_share: 0.9,
            veil_margin: 0.2,
            veil_slack: 2.0,
        }
    }
}

/// The decoded-frame window around the playhead.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct DecodeConfig {
    /// Frames kept decoded behind the playhead.
    pub window_back: u32,
    /// Frames kept decoded ahead of the playhead.
    pub window_ahead: u32,
    /// Prefetch only when the cached frames ahead/behind fell under this fraction of the window.
    pub prefetch_fraction: f64,
    /// Decoded-frame cache size in MiB.
    pub cache_mb: u32,
    /// Decoded frames are scaled down to at most this width.
    pub max_width: u32,
    /// A decode that has to start more than this many frames before the wanted one is flagged slow.
    pub max_gop_frames: u32,
    /// The seek is aimed this many milliseconds before the keyframe's timestamp (timestamps are printed
    /// rounded, and a seek that lands a hair after the keyframe would drop it).
    pub seek_backoff_ms: f64,
    /// A decoded frame whose timestamp differs from the index by more than this fraction of the local frame
    /// interval is reported as misaligned instead of being shown.
    pub align_tolerance: f64,
    /// JPEG quality of the decoded frames, ffmpeg scale 2 (best) to 31 (worst).
    pub jpeg_quality: u32,
}

impl Default for DecodeConfig {
    fn default() -> DecodeConfig {
        DecodeConfig {
            // ten seconds of video ready ahead and two behind: a refill is one keyframe interval at a time and takes
            // about 1 s at 1080p (a decode costs 300 ms plus 1.7 ms a frame), so it must start with seconds to spare,
            // and fast playback (4x eats 240 frames a second) needs a deep window. 720 frames of about 100 KB are
            // 70 MB of the 512 MB cache.
            window_back: 120,
            window_ahead: 600,
            prefetch_fraction: 0.7,
            cache_mb: 512,
            max_width: 1280,
            max_gop_frames: 600,
            seek_backoff_ms: 0.5,
            align_tolerance: 0.5,
            jpeg_quality: 3,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct AutosaveConfig {
    /// The label log is rewritten compactly when it grows beyond this many lines.
    pub compact_after_lines: u32,
    /// Flush every append to disk (a crash then loses nothing, at a small cost per label).
    pub fsync: bool,
}

impl Default for AutosaveConfig {
    fn default() -> AutosaveConfig {
        AutosaveConfig {
            compact_after_lines: 50_000,
            fsync: true,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TimelineConfig {
    /// Zoom factor per mouse-wheel notch.
    pub zoom_factor: f64,
    /// Most zoomed in: pixels per frame.
    pub max_px_per_frame: f64,
    /// Width of a timeline thumbnail in pixels.
    pub thumb_width_px: u32,
    /// JPEG quality of the thumbnails (ffmpeg MJPEG `-q:v`, 2 = best, 31 = smallest).
    pub thumb_quality: u32,
    /// Most thumbnails kept for a video; the keyframes are thinned evenly to fit.
    pub thumb_max_count: u32,
    /// Whether the thumbnail strip is generated at all.
    pub thumbs_enabled: bool,
    /// While playing, the timeline scrolls to keep the playhead at least this far from its edges.
    pub follow_margin_px: u32,
    /// Closest allowed spacing of ruler labels in pixels.
    pub ruler_spacing_px: u32,
    /// A mouse press moved less than this many pixels is a click (seek), more is a drag (pan).
    pub drag_threshold_px: u32,
}

impl Default for TimelineConfig {
    fn default() -> TimelineConfig {
        TimelineConfig {
            zoom_factor: 1.25,
            max_px_per_frame: 32.0,
            thumb_width_px: 96,
            thumb_quality: 5,
            thumb_max_count: 600,
            thumbs_enabled: true,
            follow_margin_px: 80,
            ruler_spacing_px: 90,
            drag_threshold_px: 4,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub phase: PhaseConfig,
    pub phase_v2: PhaseV2Config,
    pub index: IndexConfig,
    pub project: ProjectConfig,
    pub label: LabelConfig,
    pub decode: DecodeConfig,
    pub autosave: AutosaveConfig,
    pub timeline: TimelineConfig,
}

/// One setting as a UI shows it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SettingInfo {
    /// Stable key, `group.name`, e.g. `phase.min_run`.
    pub key: &'static str,
    pub label: &'static str,
    pub value: f64,
    pub default: f64,
    pub min: f64,
    pub max: f64,
    /// True when only whole numbers are valid.
    pub integer: bool,
    pub explanation: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
pub enum SettingError {
    UnknownKey(String),
    NotFinite(String),
    NotAnInteger(String),
    OutOfRange {
        key: String,
        value: f64,
        min: f64,
        max: f64,
    },
}

/// One row of the settings table: how to show, validate, read and write a setting.
struct Spec {
    key: &'static str,
    label: &'static str,
    min: f64,
    max: f64,
    integer: bool,
    explanation: &'static str,
    get: fn(&Settings) -> f64,
    set: fn(&mut Settings, f64),
}

static SPECS: [Spec; 49] = [
    Spec {
        key: "phase.min_run",
        label: "Phase: shortest believable run (frames)",
        min: 1.0,
        max: 1_000_000.0,
        integer: true,
        explanation: "The raw check treats shorter stretches between compatible neighbours as outliers. The hold \
detector can also bridge an interruption shorter than this when the same row returns, while keeping its odd \
observations independently flagged. A finding does not prove whether labels, capture timing or the game caused it.",
        get: |s| s.phase.min_run as f64,
        set: |s, v| s.phase.min_run = v as usize,
    },
    Spec {
        key: "phase.tick_rate",
        label: "Phase: game ticks per second of video",
        min: 1.0,
        max: 1000.0,
        integer: false,
        explanation: "How many game ticks pass per second of video time. Minecraft runs 20 per second, so 20 is \
right for real-time footage. The tick is estimated from the video timestamp, so footage that was sped up, slowed \
down or time-lapsed needs the matching value; a wrong value shows up as the phase drifting steadily and many \
shift flags. For example, half-speed slow motion is 10.",
        get: |s| s.phase.tick_rate,
        set: |s, v| s.phase.tick_rate = v,
    },
    Spec {
        key: "phase.window_ticks",
        label: "Phase: allowed phase spread (ticks)",
        min: 1.0,
        max: 16.0,
        integer: false,
        explanation: "All labelled frames of one steady stretch must have their estimated phase inside an arc of \
this many ticks. One tick is unavoidable (the sprite changes in whole ticks while time is continuous); the rest is \
room for timestamp jitter from recording or re-encoding. Lower it to catch smaller mistakes at the price of more \
false alarms on jittery footage; raise it for very jittery footage.",
        get: |s| s.phase.window_ticks,
        set: |s, v| s.phase.window_ticks = v,
    },
    Spec {
        key: "phase.max_lag_ticks",
        label: "Phase: hard discrepancy threshold (ticks)",
        min: 0.0,
        max: 16.0,
        integer: false,
        explanation: "A discrepancy larger than this receives hard review priority. Lag, capture holds, edits, \
resets and wrong labels may all cause it. This is not a Minecraft lag cap and does not prove a cause. For an \
observed hold, elapsed nominal ticks include whole animation cycles rather than only the wrapped offset.",
        get: |s| s.phase.max_lag_ticks,
        set: |s, v| s.phase.max_lag_ticks = v,
    },
    Spec {
        key: "phase.min_shift_ticks",
        label: "Phase: smallest change worth flagging (ticks)",
        min: 0.0,
        max: 16.0,
        integer: false,
        explanation: "A change of the phase level smaller than this many ticks is treated as normal timing noise \
and not flagged. Real captures wobble: on the training recording 90% of frames sit within 0.7 tick of their local \
level and 1% stray beyond 2. One tick is the physical floor (the sprite changes in whole ticks). Set 0 to see \
every boundary, however small, at the price of many flags on jittery footage.",
        get: |s| s.phase.min_shift_ticks,
        set: |s, v| s.phase.min_shift_ticks = v,
    },
    Spec {
        key: "phase.max_excursion_seconds",
        label: "Phase: longest dip that counts as a lag stall (s)",
        min: 0.0,
        max: 3600.0,
        integer: false,
        explanation: "When the phase leaves its level and returns to the same level within this many seconds of \
video, it is reported once as an excursion (the game stalled for a moment and caught up), not as two separate \
shifts. A change that stays, or returns only later than this, is a shift: that is what a cut in the footage, a \
resource reload or leaving the world looks like. Set 0 to never merge.",
        get: |s| s.phase.max_excursion_seconds,
        set: |s, v| s.phase.max_excursion_seconds = v,
    },
    Spec {
        key:"phase_v2.bin_seconds",label:"Phase: sustained-change time bins (s)",min:0.01,max:10.0,integer:false,
        explanation:"PELT compares circular means in occupied bins of this duration. Smaller bins preserve shorter timing changes at a higher processing cost. Individual label checks still run before binning.",
        get:|s|s.phase_v2.bin_seconds,set:|s,v|s.phase_v2.bin_seconds=v,
    },
    Spec {
        key:"phase_v2.penalty_ticks2",label:"Phase: sustained-change penalty",min:0.0,max:100000.0,integer:false,
        explanation:"Cost of adding another circular timing segment, in tick-squared units. Larger values favour fewer sustained changes; raw frame discrepancies are retained regardless of this penalty.",
        get:|s|s.phase_v2.penalty_ticks2,set:|s,v|s.phase_v2.penalty_ticks2=v,
    },
    Spec {
        key:"phase_v2.anchor_bins",label:"Phase: early bins anchoring the clock",min:1.0,max:1000.0,integer:true,
        explanation:"The circular median of these first occupied bins anchors the shared clock. The reference continues through holds and gaps and is never reset to a later sighting. Wrong initial labels can bias it.",
        get:|s|s.phase_v2.anchor_bins as f64,set:|s,v|s.phase_v2.anchor_bins=v as usize,
    },
    Spec {
        key:"phase_v2.held_seconds",label:"Phase: held-animation duration (s)",min:0.05,max:3600.0,integer:false,
        explanation:"A canonical sprite row held for this long in contiguous labelled frames supplies hold evidence. It may be a capture stall or repeated labels; rows alone do not prove identical whole pictures.",
        get:|s|s.phase_v2.held_seconds,set:|s,v|s.phase_v2.held_seconds=v,
    },
    Spec {
        key:"phase_v2.held_max_gap_seconds",label:"Phase: largest gap within held animation (s)",min:0.001,max:1.0,integer:false,
        explanation:"A larger timestamp gap ends a held-animation observation. Missing or unlabelled video cannot establish a continuous freeze even when the row on either side is identical.",
        get:|s|s.phase_v2.held_max_gap_seconds,set:|s,v|s.phase_v2.held_max_gap_seconds=v,
    },
    Spec {
        key:"phase_v2.recovery_samples",label:"Phase: observations confirming recovery",min:1.0,max:1000.0,integer:true,
        explanation:"Use this many actual labelled observations before and after a hold to compare clock residuals. Without enough evidence on either side, recovery stays unknown rather than being assumed.",
        get:|s|s.phase_v2.recovery_samples as f64,set:|s,v|s.phase_v2.recovery_samples=v as usize,
    },
    Spec {
        key:"phase_v2.recovery_ticks",label:"Phase: recovery tolerance (ticks)",min:0.0,max:16.0,integer:false,
        explanation:"Before and after a held row, residual centres within this circular distance support recovered timing against the same clock. Recovery never clears separate raw-frame evidence in the hold.",
        get:|s|s.phase_v2.recovery_ticks,set:|s,v|s.phase_v2.recovery_ticks=v,
    },
    Spec {
        key:"phase_v2.supplement_min_ticks",label:"Phase: smallest sustained-change supplement (ticks)",min:0.0,max:16.0,integer:false,
        explanation:"A persistent PELT change must exceed this size before adding a review flag. The existing smallest-change setting can raise this floor. Raw optimiser boundaries alone are never flags.",
        get:|s|s.phase_v2.supplement_min_ticks,set:|s,v|s.phase_v2.supplement_min_ticks=v,
    },
    Spec {
        key: "index.irregular_deviation",
        label: "Timing: irregular interval (fraction of median)",
        min: 0.01,
        max: 10.0,
        integer: false,
        explanation: "The gap between two consecutive video frames is called irregular when it differs from the \
typical (median) gap by more than this fraction of that gap. 0.5 means a gap shorter than half or longer than \
one and a half times the usual one. Millisecond rounding in mkv files makes 16 ms and 17 ms gaps look alike at \
60 fps, which is why the default is generous.",
        get: |s| s.index.irregular_deviation,
        set: |s, v| s.index.irregular_deviation = v,
    },
    Spec {
        key: "index.vfr_fraction",
        label: "Timing: share of irregular gaps that means VFR",
        min: 0.0,
        max: 1.0,
        integer: false,
        explanation: "The video is reported as variable frame rate when more than this fraction of its frame gaps \
are irregular. The default 0.01 is 1%: a single dropped-footage hole in a long recording is listed as an irregular \
gap but does not make the whole video variable frame rate. Set 0 to call any irregular gap VFR.",
        get: |s| s.index.vfr_fraction,
        set: |s, v| s.index.vfr_fraction = v,
    },
    Spec {
        key: "project.fingerprint_window_bytes",
        label: "Project: bytes hashed at each end of the video",
        min: 4096.0,
        max: 1_073_741_824.0,
        integer: true,
        explanation: "To notice that a project is opened with a different video than it was made from, the video is \
fingerprinted by its size plus a hash of its first and last N bytes. A larger window is more reliable but reads \
more (2 x N bytes per open); bytes in the middle of a very large file are never hashed. The window used is \
recorded inside each project, so changing this does not break existing projects.",
        get: |s| s.project.fingerprint_window_bytes as f64,
        set: |s, v| s.project.fingerprint_window_bytes = v as u64,
    },
    Spec {
        key: "label.advance_frames",
        label: "Label: frames to advance after labelling",
        min: 0.0,
        max: 10000.0,
        integer: true,
        explanation: "After a label is set, the playhead moves this many frames forward, so labelling a fire \
frame by frame is one click per frame. 1 is frame by frame; 3 matches one game tick at 60 fps (the sprite only \
changes every tick, so most frames repeat the previous row); 0 stays on the frame, for correcting it.",
        get: |s| s.label.advance_frames as f64,
        set: |s, v| s.label.advance_frames = v as u32,
    },
    Spec {
        key: "label.big_step_frames",
        label: "Label: frames moved by the big-step keys",
        min: 2.0,
        max: 100000.0,
        integer: true,
        explanation: "How many frames Shift plus the arrow keys move the playhead. Ten frames is a sixth of a \
second at 60 fps; raise it to cross long stretches faster, lower it for finer scrubbing.",
        get: |s| s.label.big_step_frames as f64,
        set: |s, v| s.label.big_step_frames = v as u32,
    },
    Spec {
        key: "label.advance_to_unlabelled",
        label: "Label: jump to the next unlabelled frame",
        min: 0.0,
        max: 1.0,
        integer: true,
        explanation: "1 = after labelling, skip forward to the next frame that has no label yet instead of \
moving by the fixed number of frames (useful when revisiting a half-labelled video); 0 = always move by the \
configured number of frames. If there is no unlabelled frame ahead the playhead stays.",
        get: |s| if s.label.advance_to_unlabelled { 1.0 } else { 0.0 },
        set: |s, v| s.label.advance_to_unlabelled = v != 0.0,
    },
    Spec {
        key: "label.row_type_timeout_ms",
        label: "Label: wait before committing a single typed digit (ms)",
        min: 100.0,
        max: 5000.0,
        integer: true,
        explanation: "Rows are typed as digits. Typing 4 to 9 labels at once, but 0 to 3 could be the start of a \
two-digit row (12, 31...), so the program waits this long for a second digit and then commits the single one. \
Lower it if you only ever type single digits; raise it if you type slowly. Enter commits immediately.",
        get: |s| s.label.row_type_timeout_ms as f64,
        set: |s, v| s.label.row_type_timeout_ms = v as u32,
    },
    Spec {
        key: "label.suggest_max_seconds",
        label: "Label: furthest a row suggestion reaches (s)",
        min: 0.0,
        max: 3600.0,
        integer: false,
        explanation: "The suggested row uses indexed timestamps and the nearest manually checked fire label. \
Accepted guesses do not extend its reach or calibrate the clock. The longer the distance, the more timing \
errors or cuts can throw it off; no suggestion is made beyond this distance. Set 0 to turn suggestions off.",
        get: |s| s.label.suggest_max_seconds,
        set: |s, v| s.label.suggest_max_seconds = v,
    },
    Spec {
        key: "label.suggest_calibration_seconds", label: "Label: local prediction calibration window (s)",
        min:0.0, max:3600.0, integer:false,
        explanation:"Nearby manually checked fire labels constrain the fractional 20 Hz clock phase. Conflicting evidence stops calibration rather than averaging away lag. Accepted guesses never calibrate. 0 uses only the nearest trusted anchor.",
        get:|s|s.label.suggest_calibration_seconds, set:|s,v|s.label.suggest_calibration_seconds=v,
    },
    Spec {
        key: "label.suggest_capture_frames", label: "Label: prediction capture uncertainty (frame intervals)",
        min:0.0, max:2.0, integer:false,
        explanation:"Keep a neighbouring row as an alternative near a tick boundary, allowing this many local indexed frame intervals of timing uncertainty. Default 0.5 is half a frame. This does not bound genuine lag, cuts or clock-rate errors. 0 assumes exact capture timestamps.",
        get:|s|s.label.suggest_capture_frames, set:|s,v|s.label.suggest_capture_frames=v,
    },
    Spec {
        key: "label.max_play_speed",
        label: "Label: fastest playback (x frame rate)",
        min: 1.0,
        max: 64.0,
        integer: true,
        explanation: "L plays forward and J backward; pressing the same key again doubles the speed up to this \
multiple of the video's frame rate (1, 2, 4, 8...). K or Space stops. Very high speeds just skip frames, so \
raise it only to scan long footage quickly.",
        get: |s| s.label.max_play_speed as f64,
        set: |s, v| s.label.max_play_speed = v as u32,
    },
    Spec {
        key: "label.min_play_tick_ms",
        label: "Label: shortest playback step (ms)",
        min: 4.0,
        max: 200.0,
        integer: true,
        explanation: "While playing, the picture advances at most once per this many milliseconds. Playing faster \
than that (for example 8x of a 60 fps video) moves several frames per step instead, so the speed is kept without \
overloading the screen and the decoder. 16 ms is one refresh of a 60 Hz monitor.",
        get: |s| s.label.min_play_tick_ms as f64,
        set: |s, v| s.label.min_play_tick_ms = v as u32,
    },
    Spec {
        key: "label.veil_min_share",
        label: "Veil undo: share of pixels that must look veiled",
        min: 0.05,
        max: 1.0,
        integer: false,
        explanation: "Minecraft darkens everything behind an open screen (pause menu, inventory) with a fixed translucent grey, so a veiled frame has almost no pixel outside a known brightness range. This is how much of the judged pixels must lie inside that range before 'Auto' treats a frame as veiled. Higher is stricter (fewer false undos, but a busy screen may be missed); 0.9 was validated on real recordings.",
        get: |s| s.label.veil_min_share,
        set: |s, v| s.label.veil_min_share = v,
    },
    Spec {
        key: "label.veil_margin",
        label: "Veil undo: judged margin width (share of the frame)",
        min: 0.02,
        max: 0.5,
        integer: false,
        explanation: "Only this share of the frame width on the left and on the right is checked for the veil, because inventory panels, crafting grids, buttons and the hotbar sit in the middle and would hide it. 0.2 means the outer 20% on each side; 0.5 judges the whole frame.",
        get: |s| s.label.veil_margin,
        set: |s, v| s.label.veil_margin = v,
    },
    Spec {
        key: "label.veil_slack",
        label: "Veil undo: tolerance on the brightness range (levels)",
        min: 0.0,
        max: 16.0,
        integer: false,
        explanation: "How many brightness levels (out of 255) a pixel may lie outside the exact veiled range and still count as veiled. Video compression and rounding blur the range a little; 2 is enough for the recordings tested. Raise it for heavily compressed footage, lower it to be stricter.",
        get: |s| s.label.veil_slack,
        set: |s, v| s.label.veil_slack = v,
    },
    Spec {
        key: "decode.window_back",
        label: "Decode: frames kept ready behind the playhead",
        min: 0.0,
        max: 100000.0,
        integer: true,
        explanation: "Decoded frames are kept in memory around the playhead so stepping is instant. This many \
frames behind the current one are kept ready. Stepping backwards past this window needs a new decode, which \
starts at the previous keyframe.",
        get: |s| s.decode.window_back as f64,
        set: |s, v| s.decode.window_back = v as u32,
    },
    Spec {
        key: "decode.window_ahead",
        label: "Decode: frames kept ready ahead of the playhead",
        min: 1.0,
        max: 100000.0,
        integer: true,
        explanation: "This many frames ahead of the current one are decoded in advance, so playing and stepping \
forward never waits. Larger windows mean fewer decoder restarts but more memory.",
        get: |s| s.decode.window_ahead as f64,
        set: |s, v| s.decode.window_ahead = v as u32,
    },
    Spec {
        key: "decode.prefetch_fraction",
        label: "Decode: refill when the ready frames drop below",
        min: 0.0,
        max: 1.0,
        integer: false,
        explanation: "More frames are decoded only when the ready frames on one side fall below this fraction of \
that side's window (then a whole window is fetched at once). A high value keeps the window topped up but starts \
the decoder often; a low value fetches rarely. 0 never prefetches ahead of need.",
        get: |s| s.decode.prefetch_fraction,
        set: |s, v| s.decode.prefetch_fraction = v,
    },
    Spec {
        key: "decode.cache_mb",
        label: "Decode: frame cache size (MiB)",
        min: 16.0,
        max: 65536.0,
        integer: true,
        explanation: "Memory used for decoded frames. The least recently viewed frames are dropped when it is \
full. A frame bigger than the whole cache is still kept while it is shown.",
        get: |s| s.decode.cache_mb as f64,
        set: |s, v| s.decode.cache_mb = v as u32,
    },
    Spec {
        key: "decode.max_width",
        label: "Decode: widest decoded frame (px)",
        min: 160.0,
        max: 7680.0,
        integer: true,
        explanation: "Frames are scaled down to at most this width before they are shown. Fire sprites are small, \
so raise it for 4K footage when you need to see detail; lower it to decode faster and use less memory.",
        get: |s| s.decode.max_width as f64,
        set: |s, v| s.decode.max_width = v as u32,
    },
    Spec {
        key: "decode.max_gop_frames",
        label: "Decode: slow-seek warning distance (frames)",
        min: 1.0,
        max: 1000000.0,
        integer: true,
        explanation: "Video can only be decoded from a keyframe. When the keyframe before the wanted frame is more \
than this many frames away (long keyframe intervals, typical of streaming downloads) the jump is marked as slow \
so the interface can show a spinner instead of looking frozen.",
        get: |s| s.decode.max_gop_frames as f64,
        set: |s, v| s.decode.max_gop_frames = v as u32,
    },
    Spec {
        key: "decode.seek_backoff_ms",
        label: "Decode: seek this far before the keyframe (ms)",
        min: 0.0,
        max: 100.0,
        integer: false,
        explanation: "To show a frame, the video is decoded from the keyframe before it. Timestamps are stored \
rounded, so a seek aimed exactly at the keyframe can land a hair after it and skip it, which would shift every \
frame of that decode by one. Aiming this many milliseconds early avoids that; it must stay smaller than the gap \
between two frames.",
        get: |s| s.decode.seek_backoff_ms,
        set: |s, v| s.decode.seek_backoff_ms = v,
    },
    Spec {
        key: "decode.align_tolerance",
        label: "Decode: allowed timestamp mismatch (frame intervals)",
        min: 0.01,
        max: 10.0,
        integer: false,
        explanation: "Every decoded frame is checked against the frame index: its timestamp must match the \
index entry it will be shown as, within this fraction of the local frame interval. A mismatch means the picture \
would not be the frame you think (a dropped frame, an index from another file) and is reported as an error \
instead of shown. 0.5 is half a frame; raise it only to accept sloppy timestamps knowingly.",
        get: |s| s.decode.align_tolerance,
        set: |s, v| s.decode.align_tolerance = v,
    },
    Spec {
        key: "decode.jpeg_quality",
        label: "Decode: JPEG quality (2 best, 31 worst)",
        min: 2.0,
        max: 31.0,
        integer: true,
        explanation: "Decoded frames travel to the screen as JPEG. This is ffmpeg's quantiser scale: 2 is the \
best quality and the largest pictures, 31 the smallest and blockiest. Fire sprites are small, so keep it low \
(good quality) unless transfers are slow.",
        get: |s| s.decode.jpeg_quality as f64,
        set: |s, v| s.decode.jpeg_quality = v as u32,
    },
    Spec {
        key: "autosave.compact_after_lines",
        label: "Autosave: rewrite the label log after (lines)",
        min: 1000.0,
        max: 10000000.0,
        integer: true,
        explanation: "Every label change is appended to a log, so nothing is lost on a crash, and the log grows \
with every correction. When it holds more than this many lines it is rewritten with just the current labels. \
Raise it to rewrite less often.",
        get: |s| s.autosave.compact_after_lines as f64,
        set: |s, v| s.autosave.compact_after_lines = v as u32,
    },
    Spec {
        key: "autosave.fsync",
        label: "Autosave: flush every change to disk",
        min: 0.0,
        max: 1.0,
        integer: true,
        explanation: "1 = force every label change onto the disk before carrying on, so a power cut or crash \
loses nothing; 0 = let the operating system write when it likes, which is slightly faster but can lose the last \
few labels on a crash.",
        get: |s| if s.autosave.fsync { 1.0 } else { 0.0 },
        set: |s, v| s.autosave.fsync = v != 0.0,
    },
    Spec {
        key: "timeline.zoom_factor",
        label: "Timeline: zoom per wheel notch",
        min: 1.05,
        max: 4.0,
        integer: false,
        explanation: "How much the timeline zooms for each notch of the mouse wheel. 1.25 means 25% more or less. \
The frame under the mouse pointer stays under it while zooming.",
        get: |s| s.timeline.zoom_factor,
        set: |s, v| s.timeline.zoom_factor = v,
    },
    Spec {
        key: "timeline.max_px_per_frame",
        label: "Timeline: most zoomed in (pixels per frame)",
        min: 1.0,
        max: 256.0,
        integer: false,
        explanation: "The furthest the timeline zooms in, as screen pixels per video frame. At 32 a single frame \
is a wide, easy target for clicking; lower values stop zooming earlier.",
        get: |s| s.timeline.max_px_per_frame,
        set: |s, v| s.timeline.max_px_per_frame = v,
    },
    Spec {
        key: "timeline.thumb_width_px",
        label: "Timeline: thumbnail width (px)",
        min: 32.0,
        max: 512.0,
        integer: true,
        explanation: "Width of the small preview pictures along the timeline. Wider thumbnails show more detail \
but fewer of them fit, and each one has to be decoded.",
        get: |s| s.timeline.thumb_width_px as f64,
        set: |s, v| s.timeline.thumb_width_px = v as u32,
    },
    Spec {
        key: "timeline.thumb_quality",
        label: "Timeline: thumbnail JPEG quality (2 best - 31 smallest)",
        min: 2.0,
        max: 31.0,
        integer: true,
        explanation: "How strongly the timeline thumbnails are compressed (ffmpeg's MJPEG quality scale: 2 is the \
best picture and the largest file, 31 the smallest and blockiest). Thumbnails are tiny, so the default of 5 costs \
only a few kilobytes each.",
        get: |s| s.timeline.thumb_quality as f64,
        set: |s, v| s.timeline.thumb_quality = v as u32,
    },
    Spec {
        key: "timeline.thumb_max_count",
        label: "Timeline: most thumbnails per video",
        min: 1.0,
        max: 100_000.0,
        integer: true,
        explanation: "Thumbnails are taken from the video's keyframes in one fast pass. If the video has more \
keyframes than this, they are thinned evenly (every 2nd, 3rd, ...) so that no more than this many are kept. A lower \
number is quicker to generate and uses less disk; a higher number gives more thumbnails along the timeline when zoomed in.",
        get: |s| s.timeline.thumb_max_count as f64,
        set: |s, v| s.timeline.thumb_max_count = v as u32,
    },
    Spec {
        key: "timeline.thumbs_enabled",
        label: "Timeline: show thumbnails",
        min: 0.0,
        max: 1.0,
        integer: true,
        explanation: "1 = generate the timeline thumbnails in the background when a video is opened (it is cached in \
the project folder, so this happens once); 0 = never generate or draw them, e.g. on a slow disk or for a huge video.",
        get: |s| if s.timeline.thumbs_enabled { 1.0 } else { 0.0 },
        set: |s, v| s.timeline.thumbs_enabled = v != 0.0,
    },
    Spec {
        key: "timeline.follow_margin_px",
        label: "Timeline: playhead margin while following (px)",
        min: 0.0,
        max: 2000.0,
        integer: true,
        explanation: "While the video plays or you step, the timeline scrolls just enough to keep the playhead at \
least this many pixels from its left and right edges. A margin of half the timeline width or more keeps the \
playhead centred; 0 scrolls only when it would leave the view.",
        get: |s| s.timeline.follow_margin_px as f64,
        set: |s, v| s.timeline.follow_margin_px = v as u32,
    },
    Spec {
        key: "timeline.ruler_spacing_px",
        label: "Timeline: closest ruler labels (px)",
        min: 10.0,
        max: 1000.0,
        integer: true,
        explanation: "The time ruler picks the smallest round time step (1 s, 5 s, 1 min...) whose labels are at \
least this many pixels apart. Lower values give a denser ruler; raise it if the labels crowd each other.",
        get: |s| s.timeline.ruler_spacing_px as f64,
        set: |s, v| s.timeline.ruler_spacing_px = v as u32,
    },
    Spec {
        key: "timeline.drag_threshold_px",
        label: "Timeline: click or drag (px)",
        min: 1.0,
        max: 100.0,
        integer: true,
        explanation: "A mouse press on the timeline that moves less than this many pixels before release is a \
click and jumps to that frame; moving further is a drag and pans the timeline instead. Raise it if clicks are \
taken for drags (shaky hand, touch pad).",
        get: |s| s.timeline.drag_threshold_px as f64,
        set: |s, v| s.timeline.drag_threshold_px = v as u32,
    },
];

fn spec(key: &str) -> Result<&'static Spec, SettingError> {
    SPECS
        .iter()
        .find(|sp| sp.key == key)
        .ok_or_else(|| SettingError::UnknownKey(key.to_string()))
}

impl Settings {
    /// Every setting, in display order.
    pub fn describe(&self) -> Vec<SettingInfo> {
        let defaults = Settings::default();
        SPECS
            .iter()
            .map(|sp| SettingInfo {
                key: sp.key,
                label: sp.label,
                value: (sp.get)(self),
                default: (sp.get)(&defaults),
                min: sp.min,
                max: sp.max,
                integer: sp.integer,
                explanation: sp.explanation,
            })
            .collect()
    }

    pub fn get(&self, key: &str) -> Option<f64> {
        spec(key).ok().map(|sp| (sp.get)(self))
    }

    /// Validate and set one setting; on error nothing changes.
    pub fn set(&mut self, key: &str, value: f64) -> Result<(), SettingError> {
        let sp = spec(key)?;
        if !value.is_finite() {
            return Err(SettingError::NotFinite(key.to_string()));
        }
        if value < sp.min || value > sp.max {
            return Err(SettingError::OutOfRange {
                key: key.to_string(),
                value,
                min: sp.min,
                max: sp.max,
            });
        }
        if sp.integer && value.fract() != 0.0 {
            return Err(SettingError::NotAnInteger(key.to_string()));
        }
        (sp.set)(self, value);
        Ok(())
    }

    /// Put one setting back to its default.
    pub fn reset(&mut self, key: &str) -> Result<(), SettingError> {
        let sp = spec(key)?;
        let default = (sp.get)(&Settings::default());
        (sp.set)(self, default);
        Ok(())
    }
}
