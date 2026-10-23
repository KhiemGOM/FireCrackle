//! `--from` / `--to`: a portion of the video as frames or times. A bare integer is a frame number (the unit every
//! report uses); a time has a colon or an `s` suffix. Ways this breaks: "90" read as seconds instead of a frame;
//! minutes/hours with fractions; garbage or negative input must be an error, not frame 0; the seek must land on the
//! requested frame even though Matroska stores timestamps rounded to the millisecond (so it starts half a frame early
//! and takes an exact frame count).
use hud_cadence::portion::{frame_count, parse_position, seek_seconds};

#[test]
fn a_bare_integer_is_a_frame_and_times_need_a_colon_or_s() {
    assert_eq!(parse_position("61270", 60), Ok(61270));
    assert_eq!(parse_position("90", 60), Ok(90));
    assert_eq!(parse_position("90s", 60), Ok(5400));
    assert_eq!(parse_position("1021.5s", 60), Ok(61290));
    assert_eq!(parse_position("17:01.5", 60), Ok(61290));
    assert_eq!(parse_position("0:17:01.5", 60), Ok(61290));
    assert_eq!(parse_position("1:00:00", 60), Ok(216000));
    assert_eq!(parse_position(" 0 ", 60), Ok(0));
    assert_eq!(parse_position("2.5s", 30), Ok(75));
}

#[test]
fn malformed_or_negative_positions_are_errors() {
    for bad in ["", "abc", "-5", "-1s", "1:2:3:4", "1:xx", "12.5", "s", "1:60.5x"] {
        assert!(parse_position(bad, 60).is_err(), "{bad:?} should be rejected");
    }
}

#[test]
fn the_seek_starts_half_a_frame_early_and_the_count_is_inclusive() {
    assert_eq!(seek_seconds(0, 60), 0.0);
    assert!((seek_seconds(61270, 60) - 61269.5 / 60.0).abs() < 1e-9);
    assert_eq!(frame_count(61200, 61600), Ok(401));
    assert_eq!(frame_count(5, 5), Ok(1));
    assert!(frame_count(10, 9).is_err());
}
