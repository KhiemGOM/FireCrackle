# Third-party materials

The root MIT license applies to original FireCracking/FireCrackle code and documentation. It does not transfer ownership of upstream material or user data.

## Minecraft textures and icon artwork

The build-generated `FireCrackle/public/portal.png` is the vanilla Minecraft 1.16.5 nether-portal animation, extracted from a local client or Mojang's hash-verified client download for portal-overlay correction. It is ignored by Git and belongs to Mojang/Microsoft, under the same asset attribution below.

The fire textures in `FireCrackle/src/assets`, `fire-detection/data/assets` and `fire-detection/core/testdata/*.rgba` are derived from Minecraft 1.16.5 textures. The app's current campfire artwork and derived icons in `FireCrackle/src-tauri/icons`, together with `FireCrackle/public/favicon.png`, are Minecraft-derived artwork. These materials are **not covered by this repository's MIT grant**. Minecraft and its assets belong to Mojang/Microsoft; this is an independent project, not an official Minecraft product.

These fixtures are used to match the game's actual animation and to test that matching. Their presence is not a claim of a separate redistribution license. Review the applicable Minecraft terms and permissions before distributing these assets beyond their permitted use. Changes to source visibility are a separate owner decision; this cleanup does not publish the source repository.

## Minecraft code and Yarn

No Minecraft game source, decompiled Java, game JAR or Yarn mappings are vendored as project source. Research notes describe observed behavior in original prose and identify classes/versions so developers can verify it in their own local environment. Fabric/Loom resolves game and mapping dependencies into ignored local caches. Those downloads are not project-authored or MIT-licensed.

The tracked `fire-detection/mod/gradle/wrapper/gradle-wrapper.jar` is the Gradle bootstrapper, not a Minecraft game JAR. Gradle is separately licensed by its upstream project.

## FFmpeg

FFmpeg and FFprobe are separate executable programs, not linked into the app or included in Windows installers/portable archives. An installed pair is reused where available; otherwise Windows downloads the Gyan full-build package (7z, includes the dav1d AV1 decoder; never the essentials build) pinned by `FireCrackle/release/runtime-lock.json`, verifies its SHA-256 and caches it in app data. This build is GPLv3; its original LICENSE, README with build/dependency details, and source links are retained beside the cached executables. Build/test preparation may also download a local runtime; it must not be copied into release packages. Do not represent FFmpeg as MIT-licensed.

Linux packages use the system FFmpeg/FFprobe installed through the user's distribution; they do not redistribute the Windows runtime. The Debian package declares FFmpeg as a dependency. Distribution-provided libraries and tools retain their own license terms.

## yt-dlp and Deno

Online video importing is powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and its contributors. [Deno](https://github.com/denoland/deno) provides the JavaScript runtime used for YouTube extraction. Neither executable is included in the installer or portable archive: the app downloads official releases pinned in `FireCrackle/release/download-tools.json`, verifies SHA-256, and caches them in app data on first use.

yt-dlp source is released under the [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE). Its standalone binaries also contain third-party components with their own licenses (including Python and bundled libraries); consult the [upstream licensing details](https://github.com/yt-dlp/yt-dlp#license) and [third-party notices](https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt). The official binaries include yt-dlp-ejs scripts, which carry Unlicense/MIT/ISC notices. These upstream licenses are not replaced by FireCrackle's MIT license.

Deno is [MIT-licensed](https://github.com/denoland/deno/blob/main/LICENSE.md) and includes separately licensed components described in its [third-party notices](https://github.com/denoland/deno/blob/main/third_party/README.md). Original licenses/notices present in downloaded archives are retained; upstream links and checksums are saved in the tool cache. Downloaded content retains its owners' rights.

## App libraries and build tools

React, Tauri, Rust crates, Python packages, Fabric/Loom and Gradle retain their own licenses. Exact JavaScript/Rust versions are recorded in their lockfiles; Python requirements and Gradle coordinates are recorded with the corresponding tools. Check their upstream notices when redistributing dependencies.

## Recordings and experiment outputs

Recordings, labels and measured benchmark tables may contain personal paths or content owned by their creators. Generated/private datasets are not part of the source distribution. Published research summaries state their inputs and limitations; they do not grant access to private recordings.

## AI inference

The no-fire model uses a MobileNetV3 Small backbone from torchvision, fine-tuned for FireCrackle. torchvision source is BSD-3-Clause licensed; its pretrained backbone originates from ImageNet. These upstream materials retain their own terms and provenance. The model's source-checkpoint and exported ONNX hashes are pinned in `FireCrackle/release/no-fire-model.json`; weights are release resources, not vendored source or game assets.

The ordinary-fire and soul-fire quad phase models use separate ResNet-101 backbones from torchvision, initialized from generic ImageNet weights and fine-tuned on real recorded quad crops. Their checkpoint/export provenance and hashes are pinned separately in `FireCrackle/release/quad-phase-model.json` and `FireCrackle/release/quad-soul-phase-model.json`. The same upstream attribution and provenance distinction apply; neither model is a redistributed recording or texture atlas. Model weights remain outside Git source.

ONNX Runtime 1.22.0 is distributed under its upstream MIT license with its third-party notices. Windows packages also include Microsoft DirectML 1.15.4 under the accompanying Microsoft redistributable terms. The exact upstream LICENSE, LICENSE-CODE and third-party notices extracted from the pinned official archives are included beside the native libraries in `ai/`. Linux packages include ONNX Runtime with CPU and CUDA providers and its notices; CUDA/cuDNN are separately installed vendor runtime dependencies. These licenses are not replaced by the project's MIT grant. End users do not install Python, torchvision or CUDA to run the app.

## ECC alignment

The lightweight TypeScript ECC registration in `FireCrackle/src/lib/ecc.ts` follows OpenCV's masked homography implementation in [modules/video/src/ecc.cpp](https://github.com/opencv/opencv/blob/4.13.0/modules/video/src/ecc.cpp). It adds independent finite-geometry, bidirectional consistency and conservative final-adjustment checks; it is not the OpenCV binary. The upstream source carries this Intel BSD license:

Copyright (C) 2000, Intel Corporation, all rights reserved.
Third party copyrights are property of their respective owners.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

- Redistribution's of source code must retain the above copyright notice,
  this list of conditions and the following disclaimer.
- Redistribution's in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
- The name of Intel Corporation may not be used to endorse or promote products
  derived from this software without specific prior written permission.

This software is provided by the copyright holders and contributors "as is" and
any express or implied warranties, including, but not limited to, the implied
warranties of merchantability and fitness for a particular purpose are disclaimed.
In no event shall the Intel Corporation or contributors be liable for any direct,
indirect, incidental, special, exemplary, or consequential damages
(including, but not limited to, procurement of substitute goods or services;
loss of use, data, or profits; or business interruption) however caused
and on any theory of liability, whether in contract, strict liability,
or tort (including negligence or otherwise) arising in any way out of
the use of this software, even if advised of the possibility of such damage.
