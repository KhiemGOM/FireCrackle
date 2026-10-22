# First-person scan performance

2026-10-16. The running instance was `src-tauri/target/debug/firecrackle.exe`.
The previous development profile left the detector unoptimized. Its dependency
now uses optimization level 3 even in development.

The scanner now overlaps decoding with four CPU matching workers. It reuses a
bounded pool of RGB buffers (workers + 2, with a 256 MiB budget), preserves frame
indices, sorts accepted results before application, and retains cancellation.
Every frame is still examined at native resolution with both FOVs and the same
threshold. There is no frame skipping or changed decision rule.

Exact hot-path changes:

- Cache expected colour ratios and calculate observed ratios once per probe.
- Count silhouette agreement with packed XOR/popcount, preserving integer counts.
- Reverse GUI veil only at detector probes, with the same rounding as the full-image operation.
- Stop veil detection once its original 90% decision is mathematically settled.

## Measurements

Windows, 32 logical CPUs. These are local wall times, not promises for other videos.
Baseline was built before optimization from the tested matcher in `81ed65a`.

Original `2026-10-15 18-18-16.mkv`, first 900 frames, 1920×1080:

Input SHA-256: `91E6FA9DB3202E005B351B1F2DB28B81A6050AD0F4435BC613049FE25045845D`.

| Path | Seconds | Frames/sec | Accepted frames |
|---|---:|---:|---:|
| Old release, sequential | 16.335 | 55.1 | 17 |
| Optimized CPU, 4 workers | 2.241 | 401.7 | 17 |
| Optimized CPU, 8 workers | 2.232 | 403.2 | 17 |
| CPU 4 workers, decoder limited to 4 threads | 2.842 | 316.7 | 17 |
| D3D11VA GPU decode, 4 matching workers | 2.611 | 344.7 | 17 |

Four workers give about **7.3×** the previous release throughput in this window.
Eight gave essentially the same original-video throughput and were slower on the
mixed-scene sample below, so four is the default. Decoder thread count is left automatic.

CPU baseline and optimized CSVs are byte-identical, including row, FOV, evidence,
and hashes of **all row rankings, scores, presence and evidence for both FOVs**.
SHA-256: `6BE53450ABAA94F1DC879C5B245F6F4DE7808826CE5F0E639520B7136F3F0D26`.
GPU decoding was slower. It changed score hashes on all 900 frames, although its
17 accepted row results agreed in this window. GPU decoding is not enabled in the app.

A separate lossless FFV1 sample contains original frame ranges 0–31, 765–796,
and 14580–14611: 96 frames spanning absent fire, visible fire and GUI veil.
Fixture SHA-256: `C95681F76544CE3CE8041C4EF0A71CF40715703AA1013FC0C7DB8FA57328A7FD`.

| Path | Seconds | Frames/sec |
|---|---:|---:|
| Old release, sequential | 1.346 | 71.3 |
| Optimized 1 worker, runs 1 / 2 | 0.515 / 0.531 | 186.3 / 180.9 |
| Optimized 4 workers, runs 1 / 2 | 0.487 / 0.491 | 197.0 / 195.4 |
| Optimized 8 workers, runs 1 / 2 | 0.517 / 0.506 | 185.8 / 189.9 |

All seven result CSVs have the same SHA-256:
`2802B065CA2DBFE2D8B2A6F5488A1EA0212032EDC51F827AAD70032D9B5215FB`.
The baseline spent 189 ms detecting veil, 237 ms unveiling full frames and 625 ms
matching. The optimized pipeline is predominantly waiting for decoded RGB input.

## Reproduction and retained evidence

`core/src/bin/pov_perf.rs` accepts `VIDEO OUTCSV FRAME_COUNT WORKERS`.
Set `POV_FFMPEG` and `POV_FFPROBE` to the tool paths. `POV_HWACCEL=d3d11va`
and `POV_THREADS=4` reproduce the optional decoder experiments; neither is an app default.
Build with `cargo build --release --manifest-path core/Cargo.toml --bin pov_perf --offline`.

Raw CSVs and the frozen baseline executable remain locally in ignored
`fire-detection/core/target/`: `pov-original-baseline.csv`, `pov-original-cpu.csv`,
`pov-original-gpu.csv`, `pov-original-cpu-workers8.csv`, `pov-original-cpu-threads4.csv`,
`pov-baseline.csv`, `pov-new-{1,4,8}-{1,2}.csv`, and `pov_perf-baseline.exe`.

Tests cover bounded parallel execution, index/result preservation, early/extra EOF,
processing errors, cancellation, exact exhaustive veil parity, and bitwise equality
of sparse versus full-frame unveil matching. The native scanner also passes the
known accepted clip2 frame765 smoke test (row27). These are performance/parity
checks; they do not establish new detector accuracy on unseen footage.
