//! Which package a running copy of FireCrackle came from, so the update banner offers the right download. A Windows
//! copy with an `uninstall.exe` beside it was installed by the setup; without one it is the portable ZIP. On Linux the
//! AppImage runtime sets `APPIMAGE`; the Debian package puts the program under `/usr`.

use std::path::Path;
use studio_core::install_kind::{classify, detect, InstallKind};

const WIN_INSTALLED: &str = r"C:\Users\me\AppData\Local\FireCrackle\firecrackle.exe";
const WIN_PORTABLE: &str = r"D:\Tools\FireCrackle-0.2.2-windows-x64\FireCrackle.exe";

#[test]
fn a_windows_copy_with_an_uninstaller_beside_it_is_the_installed_one() {
    let kind = classify(
        "windows",
        Path::new(WIN_INSTALLED),
        &["firecrackle.exe", "uninstall.exe"],
        false,
    );
    assert_eq!(kind, InstallKind::WindowsSetup);
}

#[test]
fn the_uninstaller_is_found_whatever_its_letter_case() {
    for name in ["Uninstall.exe", "UNINSTALL.EXE", "uninstall.exe"] {
        assert_eq!(
            classify("windows", Path::new(WIN_INSTALLED), &[name], false),
            InstallKind::WindowsSetup,
            "{name}"
        );
    }
}

#[test]
fn a_windows_copy_without_one_is_portable() {
    let kind = classify(
        "windows",
        Path::new(WIN_PORTABLE),
        &["FireCrackle.exe", "README.txt", "LICENSE.txt"],
        false,
    );
    assert_eq!(kind, InstallKind::WindowsPortable);
    assert_eq!(
        classify("windows", Path::new(WIN_PORTABLE), &[], false),
        InstallKind::WindowsPortable
    );
}

#[test]
fn files_that_only_look_like_an_uninstaller_do_not_count() {
    for name in [
        "uninstall.txt",
        "uninstall-helper.exe",
        "my-uninstall.exe",
        "uninstall.exe.bak",
        "uninstaller.exe",
    ] {
        assert_eq!(
            classify("windows", Path::new(WIN_PORTABLE), &[name], false),
            InstallKind::WindowsPortable,
            "{name}"
        );
    }
}

#[test]
fn the_appimage_variable_means_an_appimage_even_though_the_program_runs_from_a_temporary_mount() {
    let exe = Path::new("/tmp/.mount_FireCrXyz/usr/bin/firecrackle");
    assert_eq!(
        classify("linux", exe, &[], true),
        InstallKind::LinuxAppimage
    );
}

#[test]
fn the_appimage_variable_wins_over_the_path() {
    assert_eq!(
        classify("linux", Path::new("/usr/bin/firecrackle"), &[], true),
        InstallKind::LinuxAppimage
    );
}

#[test]
fn a_program_under_usr_without_the_variable_is_the_debian_package() {
    assert_eq!(
        classify("linux", Path::new("/usr/bin/firecrackle"), &[], false),
        InstallKind::LinuxDeb
    );
    assert_eq!(
        classify(
            "linux",
            Path::new("/usr/lib/firecrackle/firecrackle"),
            &[],
            false
        ),
        InstallKind::LinuxDeb
    );
}

#[test]
fn a_linux_program_from_anywhere_else_is_not_guessed_at() {
    for path in [
        "/home/me/build/firecrackle",
        "/opt/firecrackle/firecrackle",
        "/tmp/x/firecrackle",
        "firecrackle",
        "/usrlocal/firecrackle",
        "",
    ] {
        assert_eq!(
            classify("linux", Path::new(path), &[], false),
            InstallKind::Unknown,
            "{path:?}"
        );
    }
}

#[test]
fn other_systems_are_unknown() {
    for os in ["macos", "freebsd", "", "WINDOWS ", "android"] {
        assert_eq!(
            classify(os, Path::new(WIN_INSTALLED), &["uninstall.exe"], true),
            InstallKind::Unknown,
            "{os:?}"
        );
    }
}

#[test]
fn the_names_the_front_end_reads_are_snake_case() {
    let json = |k: InstallKind| serde_json::to_string(&k).unwrap();
    assert_eq!(json(InstallKind::WindowsSetup), "\"windows_setup\"");
    assert_eq!(json(InstallKind::WindowsPortable), "\"windows_portable\"");
    assert_eq!(json(InstallKind::LinuxAppimage), "\"linux_appimage\"");
    assert_eq!(json(InstallKind::LinuxDeb), "\"linux_deb\"");
    assert_eq!(json(InstallKind::Unknown), "\"unknown\"");
}

#[test]
fn detecting_the_running_program_gives_an_answer_that_fits_this_system() {
    let kind = detect();
    if cfg!(windows) {
        assert!(
            matches!(
                kind,
                InstallKind::WindowsSetup | InstallKind::WindowsPortable
            ),
            "{kind:?}"
        );
    } else if cfg!(target_os = "linux") {
        assert!(
            matches!(
                kind,
                InstallKind::LinuxAppimage | InstallKind::LinuxDeb | InstallKind::Unknown
            ),
            "{kind:?}"
        );
    } else {
        assert_eq!(kind, InstallKind::Unknown);
    }
}
