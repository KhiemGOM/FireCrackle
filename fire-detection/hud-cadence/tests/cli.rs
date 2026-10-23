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

#[test]
fn frame_numbers_from_a_portion_are_the_video_s_own_and_match_jolt() {
    // the same readings, but the scan started at video frame 1000: every frame in the output is 1000 later,
    // so Jolt's bracket (1240 - 1360) finds the short pair 1250 -> 1291
    let d = dir("portion");
    let mut v = values_json();
    v["first_frame"] = serde_json::json!(1000);
    v["start"] = serde_json::json!(1000.0 / 60.0);
    std::fs::write(d.join("in.json"), v.to_string()).unwrap();
    let j = serde_json::json!({"breaks": [{"kind": "removed", "jump_seconds": 0.3, "frame_positions": [{"number": 1240}, {"number": 1360}]}]});
    std::fs::write(d.join("jolt.json"), j.to_string()).unwrap();
    let st = bin().arg("report").arg(d.join("in.json")).arg("--jolt").arg(d.join("jolt.json"))
        .arg("--out").arg(d.join("out.json")).arg("--report").arg(d.join("report.md")).status().unwrap();
    assert!(st.success());
    let out: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join("out.json")).unwrap()).unwrap();
    assert_eq!(out["first_frame"], 1000);
    let jump = out["findings"].as_array().unwrap().iter().find(|f| f["kind"] == "Jump").unwrap();
    assert_eq!(jump["frame"], 1291);
    assert_eq!(jump["hms"], "00:00:21.517"); // 1291 / 60
    assert_eq!(out["changes"][0][0], 1070);
    assert_eq!(out["jolt"][0]["cadence_missing"], 19);
    let md = std::fs::read_to_string(d.join("report.md")).unwrap();
    assert!(md.contains("| 1250 | 1291 | 41 | -19 |"), "{md}");
    assert!(md.contains("frames 1000 – 1639"), "the header names the portion: {md}");

    // our own --out read back keeps the absolute frames (no second offset)
    let st = bin().arg("report").arg(d.join("out.json")).arg("--jolt").arg(d.join("jolt.json"))
        .arg("--report").arg(d.join("again.md")).status().unwrap();
    assert!(st.success());
    assert_eq!(std::fs::read_to_string(d.join("again.md")).unwrap(), md);
}

#[test]
fn a_bad_portion_is_refused_with_a_message() {
    let out = bin().args(["find", "nonexistent.mkv", "--from", "500", "--to", "400"]).output().unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("--to"), "{}", String::from_utf8_lossy(&out.stderr));
    let out = bin().args(["find", "nonexistent.mkv", "--from", "abc"]).output().unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("--from"), "{}", String::from_utf8_lossy(&out.stderr));
}
