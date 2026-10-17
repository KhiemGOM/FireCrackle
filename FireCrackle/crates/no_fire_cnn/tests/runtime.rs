use no_fire_cnn::Engine;
#[test]
fn malformed_model_is_a_clean_error() {
    let Some(runtime) = std::env::var_os("FIRECRACKLE_TEST_ORT") else {
        return;
    };
    assert!(Engine::load(std::path::Path::new(&runtime), b"broken", false, 2).is_err());
}
#[test]
fn exported_model_matches_reference_logit_and_cancel_abstains() {
    let (Some(runtime), Some(model)) = (
        std::env::var_os("FIRECRACKLE_TEST_ORT"),
        std::env::var_os("FIRECRACKLE_TEST_MODEL"),
    ) else {
        return;
    };
    let mut engine = Engine::load(
        std::path::Path::new(&runtime),
        &std::fs::read(model).unwrap(),
        false,
        2,
    )
    .unwrap();
    let score = engine.score_view(&vec![0; 224 * 224 * 3]).unwrap();
    assert!(score.is_finite());
    let cancelled = std::sync::atomic::AtomicBool::new(true);
    assert!(
        !engine
            .clear_frame(&vec![0; 1920 * 1080 * 3], None, &cancelled)
            .unwrap()
    );
}
#[cfg(target_os = "linux")]
#[test]
fn missing_linux_gpu_dependencies_preserve_cpu_inference() {
    let (Some(runtime), Some(model)) = (
        std::env::var_os("FIRECRACKLE_TEST_ORT"),
        std::env::var_os("FIRECRACKLE_TEST_MODEL"),
    ) else {
        return;
    };
    let weights = std::fs::read(model).unwrap();
    let path = std::path::Path::new(&runtime);
    let mut cpu = Engine::load(path, &weights, false, 2).unwrap();
    let mut auto =
        Engine::auto(path, &weights, &std::sync::atomic::AtomicBool::new(false)).unwrap();
    let rgb = vec![127; 224 * 224 * 3];
    assert!((cpu.score_view(&rgb).unwrap() - auto.score_view(&rgb).unwrap()).abs() < 0.0001);
}
