//! Read-only benchmark adapter: run the shipped video-time checker on exactly the scored Jolt frames.
use serde_json::{json, Value};
use studio_core::{config::Settings, label::Label, phase::FrameObs, phase_v2};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 {
        return Err("jolt_benchmark INPUTS.json OUTPUT.json".into());
    }
    let input: Value = serde_json::from_str(&std::fs::read_to_string(&args[1])?)?;
    let mut results = vec![];
    for case in input["cases"].as_array().ok_or("cases missing")? {
        let points: Vec<_> = case["points"]
            .as_array()
            .ok_or("points missing")?
            .iter()
            .filter(|p| p["fire"] == true)
            .map(|p| FrameObs {
                frame: p["frame"].as_u64().unwrap() as u32,
                pts: p["pts"].as_f64().unwrap(),
                label: Label::Fire {
                    sheet: 1,
                    row: p["step"].as_u64().unwrap() as u8,
                    mirrored: false,
                },
            })
            .collect();
        let analysis = phase_v2::analyze(&points, &Settings::default())?;
        results.push(json!({"name":case["name"],"points":points.len(),"flags":analysis.flags}));
    }
    std::fs::write(&args[2], serde_json::to_string_pretty(&results)?)?;
    Ok(())
}
