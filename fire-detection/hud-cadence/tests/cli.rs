//! Output files: `--out` is the machine JSON only (no `.txt` beside it any more), `--report` is the readable
//! Markdown with every interpreted table, including one per Jolt break when `--jolt` is given. Ways this breaks:
//! an old findings-only JSON has no change frames, so a Jolt table cannot be built from it and must say so instead
//! of printing an empty "agrees"; re-reading our own `--out` must give the same report.
use std::process::Command;

fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_hud-cadence"))
}

fn dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("hud-cadence-cli-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Per-frame readings: phase 10, a 19-frame removal after frame 250 (next change at 291), then on.
fn values_json() -> serde_json::Value {
    let frames = [10u32, 70, 130, 190, 250, 291, 351, 411, 471, 531, 591];
    let mut v: Vec<Option<String>> = vec![None; 640];
    for (k, &f) in frames.iter().enumerate() {
        let end = frames.get(k + 1).copied().unwrap_or(640);
        for i in f..end {
            v[i as usize] = Some((100 + k).to_string());
        }
    }
    serde_json::json!({"video": "test.mkv", "fps": 60, "start": 0.0, "values": v})
}

fn jolt_json() -> serde_json::Value {
    serde_json::json!({"version": "2.5", "breaks": [{"from": 4.0, "to": 6.0, "kind": "removed", "jump_seconds": 0.3,
        "frame_positions": [{"number": 240}, {"number": 360}]}]})
}

#[test]
fn out_is_pure_json_and_report_is_markdown_with_the_jolt_table() {
    let d = dir("split");
    std::fs::write(d.join("in.json"), values_json().to_string()).unwrap();
    std::fs::write(d.join("jolt.json"), jolt_json().to_string()).unwrap();
    let st = bin().arg("report").arg(d.join("in.json"))
        .arg("--jolt").arg(d.join("jolt.json"))
        .arg("--out").arg(d.join("out.json"))
        .arg("--report").arg(d.join("report.md"))
        .status().unwrap();
    assert!(st.success());
    assert!(!d.join("out.json.txt").exists(), "--out must not write a text table any more");
    let out: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join("out.json")).unwrap()).unwrap();
    assert!(out["findings"].as_array().unwrap().iter().any(|f| f["kind"] == "Jump" && f["frame"] == 291));
    assert_eq!(out["changes"].as_array().unwrap().len(), 10); // the first reading is not a change
    let w = &out["jolt"][0];
    assert_eq!((w["from"].as_u64(), w["to"].as_u64(), w["cadence_missing"].as_i64(), w["jolt_missing"].as_i64(), w["agree"].as_bool()),
        (Some(240), Some(360), Some(19), Some(18), Some(true)));
    let md = std::fs::read_to_string(d.join("report.md")).unwrap();
    assert!(md.starts_with("# "), "{md}");
    assert!(md.contains("## Inside each Jolt break"), "{md}");
    assert!(md.contains("| 250 | 291 | 41 | -19 |"), "the short pair row, plain numbers: {md}");
    assert!(md.contains("## Ranked by |ΔFPS|"), "{md}");

    // our own --out read back gives the same Markdown (it carries the change frames)
    let st = bin().arg("report").arg(d.join("out.json"))
        .arg("--jolt").arg(d.join("jolt.json"))
        .arg("--report").arg(d.join("again.md"))
        .status().unwrap();
    assert!(st.success());
    assert_eq!(std::fs::read_to_string(d.join("again.md")).unwrap(), md);
}

#[test]
fn a_findings_only_json_cannot_give_a_jolt_table_and_says_so() {
    let d = dir("old");
    let old = serde_json::json!({"video": "old.mkv", "fps": 60, "start": 0.0, "frames": 640, "readable": 600,
        "findings": [{"kind": "Jump", "frame": 291, "shift": -19, "before": "104", "after": "105", "delta": 1}]});
    std::fs::write(d.join("old.json"), old.to_string()).unwrap();
    std::fs::write(d.join("jolt.json"), jolt_json().to_string()).unwrap();
    let st = bin().arg("report").arg(d.join("old.json"))
        .arg("--jolt").arg(d.join("jolt.json"))
        .arg("--report").arg(d.join("report.md"))
        .status().unwrap();
    assert!(st.success());
    let md = std::fs::read_to_string(d.join("report.md")).unwrap();
    assert!(md.contains("no change frames in this file"), "{md}");
    assert!(md.contains("| Jump |"), "the ranked findings are still there: {md}");
}
