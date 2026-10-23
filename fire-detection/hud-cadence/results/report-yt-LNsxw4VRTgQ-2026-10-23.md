# hud-cadence report: D:/Coding/Minecraft/FireCracking/fire-detection/data/video/yt-LNsxw4VRTgQ.mkv

839409 frames at 60 fps; overlay readable on 590945 (70.4 %); 494 findings.

## Jumps (phase moved >= 3 frames and stayed), in time order

| time | frame | shift | before | after | \|d\| | flags |
|---|---|---|---|---|---|---|
| 01:56:07.700 | 418062 | -4 | 422 | 381 | 41 |  |
| 01:59:46.617 | 431197 | -3 | 502 | 518 | 16 |  |
| 02:07:44.683 | 459881 | +4 | 269 | 236 | 33 |  |
| 02:11:57.617 | 475057 | -3 | 341 | 375 | 34 |  |
| 02:15:30.567 | 487834 | -3 | 370 | 396 | 26 |  |
| 03:41:50.983 | 798659 | -5 | 693 | 628 | 65 |  |

## Inside each Jolt break

Jolt report: `results/jolt-2.5-yt-LNsxw4VRTgQ-2026-10-23.json`. Each break lists every pair of consecutive FPS changes overlapping Jolt's bracket, plus one
pair of context on each side. A pair should be a whole number of seconds (60 frames); the deviation is the
remainder (negative = frames missing). Cadence missing = minus the sum over the inside pairs, counted modulo one
second (±2 frames read error). Agree = the two counts match modulo one second within ±3 frames.

| # | kind | bracket (frames) | time | Jolt missing | cadence missing | agree |
|---|---|---|---|---|---|---|
| 1 | removed | 27522 – 27652 | 00:07:38.700 | 8 f | no readings | n/a |
| 2 | removed | 741273 – 741409 | 03:25:54.550 | 20 f | no readings | n/a |
| 3 | removed | 798481 – 798613 | 03:41:48.017 | 6 f | 5 f (±2) | yes |

### Break 1: removed, frames 27522 – 27652 (00:07:38.700 – 00:07:40.867)

No FPS readings around this bracket (overlay off or hidden).

### Break 2: removed, frames 741273 – 741409 (03:25:54.550 – 03:25:56.817)

| from | to | spacing | deviation | before | after | where | note |
|---|---|---|---|---|---|---|---|
| 729846 | 730361 | 515 | -25 | 4 | 6 | context | spans 8.6 s: crosses an unreadable stretch, not counted |
| 730361 | 747938 | 17577 | -3 | 6 | 243 | inside | spans 292.9 s: crosses an unreadable stretch, not counted |
| 747938 | 747964 | 26 | +26 | 243 | 274 | context | **26 frames added** |

### Break 3: removed, frames 798481 – 798613 (03:41:48.017 – 03:41:50.217)

| from | to | spacing | deviation | before | after | where | note |
|---|---|---|---|---|---|---|---|
| 798364 | 798424 | 60 | 0 | 737 | 563 | context |  |
| 798424 | 798484 | 60 | 0 | 563 | 763 | inside |  |
| 798484 | 798544 | 60 | 0 | 763 | 788 | inside |  |
| 798544 | 798604 | 60 | 0 | 788 | 693 | inside |  |
| 798604 | 798659 | 55 | -5 | 693 | 628 | inside | **5 frames missing** |
| 798659 | 798719 | 60 | 0 | 628 | 341 | context |  |

## Ranked by |ΔFPS|

| rank | kind | time | frame | shift | before | after | \|d\| | note |
|---|---|---|---|---|---|---|---|---|
| 1 | Value | 03:16:51.733 | 708704 |  | 822 | 4 | 818 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 2 | Value | 03:11:25.783 | 689147 |  | 686 | 4 | 682 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 3 | Value | 03:11:24.533 | 689072 |  | 6 | 686 | 680 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 4 | Value | 03:22:00.400 | 727224 |  | 6 | 628 | 622 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 5 | Value | 03:52:57.950 | 838677 |  | 549 | 1169 | 620 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 6 | Value | 02:01:19.633 | 436778 |  | 842 | 294 | 548 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 7 | Value | 01:25:27.200 | 307632 |  | 5 | 548 | 543 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 8 | Value | 03:47:08.017 | 817681 |  | 5 | 546 | 541 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 9 | Value | 03:20:29.400 | 721764 |  | 62 | 600 | 538 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 10 | Value | 03:17:08.400 | 709704 |  | 508 | 4 | 504 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 11 | Value | 03:17:03.400 | 709404 |  | 4 | 506 | 502 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 12 | Value | 03:17:04.400 | 709464 |  | 506 | 4 | 502 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 13 | Value | 03:16:31.400 | 707484 |  | 3 | 500 | 497 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 14 | Value | 03:16:33.033 | 707582 |  | 500 | 4 | 496 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 15 | Value | 03:22:52.683 | 730361 |  | 502 | 6 | 496 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 16 | Value | 03:11:32.800 | 689568 |  | 4 | 470 | 466 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 17 | Value | 01:10:38.833 | 254330 |  | 803 | 346 | 457 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 18 | Value | 01:18:57.050 | 284223 |  | 4 | 442 | 438 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 19 | Drift | 03:42:49.967 | 802198 | -1 | 246 | 675 | 429 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 20 | Value | 02:54:27.500 | 628050 |  | 731 | 308 | 423 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 21 | Value | 02:32:13.533 | 548012 |  | 737 | 332 | 405 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 22 | Value | 03:22:17.400 | 728244 |  | 3 | 402 | 399 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 23 | Value | 01:23:06.767 | 299206 |  | 1066 | 669 | 397 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 24 | Value | 02:27:09.550 | 529773 |  | 684 | 287 | 397 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 25 | Value | 01:44:05.867 | 374752 |  | 3 | 390 | 387 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 26 | Value | 03:40:45.067 | 794704 |  | 623 | 237 | 386 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 27 | Value | 03:09:04.467 | 680668 |  | 722 | 348 | 374 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 28 | Value | 01:32:04.767 | 331486 |  | 364 | 732 | 368 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 29 | Value | 02:30:47.550 | 542853 |  | 710 | 345 | 365 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 30 | Drift | 03:52:56.950 | 838617 | -1 | 184 | 549 | 365 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 31 | Value | 02:41:34.517 | 581671 |  | 638 | 277 | 361 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 32 | Value | 01:22:21.767 | 296506 |  | 769 | 412 | 357 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 33 | Value | 03:47:09.583 | 817775 |  | 39 | 395 | 356 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 34 | Value | 02:32:48.533 | 550112 |  | 603 | 256 | 347 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 35 | Value | 03:47:01.967 | 817318 |  | 633 | 287 | 346 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 36 | Value | 01:25:50.767 | 309046 |  | 384 | 729 | 345 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 37 | Value | 02:54:23.500 | 627810 |  | 275 | 613 | 338 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 38 | Value | 02:18:43.567 | 499414 |  | 342 | 678 | 336 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 39 | Value | 02:31:57.533 | 547052 |  | 645 | 311 | 334 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 40 | Value | 02:48:23.500 | 606210 |  | 371 | 705 | 334 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 41 | Value | 02:32:01.533 | 547292 |  | 659 | 332 | 327 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 42 | Value | 03:41:27.067 | 797224 |  | 224 | 551 | 327 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 43 | Value | 02:23:52.817 | 517969 |  | 3 | 325 | 322 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 44 | Value | 03:42:52.983 | 802379 |  | 626 | 305 | 321 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 45 | Value | 02:55:04.500 | 630270 |  | 605 | 285 | 320 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 46 | Value | 02:34:51.550 | 557493 |  | 613 | 295 | 318 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 47 | Value | 00:55:30.833 | 199850 |  | 699 | 382 | 317 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 48 | Value | 01:32:05.767 | 331546 |  | 732 | 416 | 316 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 49 | Value | 02:27:20.550 | 530433 |  | 241 | 556 | 315 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 50 | Value | 02:28:51.550 | 535893 |  | 337 | 651 | 314 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 51 | Value | 03:51:58.983 | 835139 |  | 348 | 34 | 314 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 52 | Value | 01:04:35.367 | 232522 |  | 3 | 316 | 313 | UNSTABLE READINGS (digits flicker here, not reliable); POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 53 | Value | 01:09:35.833 | 250550 |  | 341 | 654 | 313 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 54 | Value | 03:40:44.083 | 794645 |  | 310 | 623 | 313 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 55 | Value | 03:40:48.067 | 794884 |  | 561 | 248 | 313 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 56 | Value | 03:27:53.117 | 748387 |  | 34 | 344 | 310 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 57 | Value | 01:21:43.767 | 294226 |  | 792 | 483 | 309 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 58 | Value | 02:26:53.550 | 528813 |  | 308 | 617 | 309 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 59 | Value | 01:45:43.900 | 380634 |  | 34 | 342 | 308 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 60 | Value | 02:09:01.667 | 464500 |  | 373 | 679 | 306 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 61 | Value | 02:29:44.550 | 539073 |  | 563 | 260 | 303 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 62 | Value | 03:34:37.067 | 772624 |  | 215 | 518 | 303 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 63 | Value | 01:22:29.767 | 296986 |  | 478 | 780 | 302 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 64 | Value | 02:09:03.683 | 464621 |  | 602 | 303 | 299 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 65 | Value | 02:47:18.500 | 602310 |  | 698 | 401 | 297 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 66 | Value | 03:27:57.700 | 748662 |  | 3 | 300 | 297 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 67 | Value | 02:46:34.517 | 599671 |  | 659 | 363 | 296 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 68 | Value | 02:30:30.550 | 541833 |  | 365 | 660 | 295 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 69 | Value | 02:31:31.533 | 545492 |  | 305 | 600 | 295 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 70 | Value | 02:55:00.500 | 630030 |  | 604 | 309 | 295 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 71 | Value | 03:27:51.500 | 748290 |  | 33 | 328 | 295 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 72 | Value | 03:27:55.517 | 748531 |  | 326 | 32 | 294 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 73 | Value | 03:49:53.050 | 827583 |  | 2 | 296 | 294 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 74 | Value | 02:28:00.550 | 532833 |  | 599 | 306 | 293 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 75 | Value | 02:32:03.533 | 547412 |  | 582 | 289 | 293 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 76 | Value | 02:47:15.500 | 602130 |  | 433 | 726 | 293 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 77 | Value | 03:08:28.467 | 678508 |  | 449 | 742 | 293 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 78 | Value | 01:09:25.817 | 249949 |  | 473 | 765 | 292 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 79 | Value | 01:15:16.800 | 271008 |  | 308 | 599 | 291 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 80 | Value | 01:26:42.767 | 312166 |  | 617 | 326 | 291 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 81 | Value | 02:24:41.550 | 520893 |  | 617 | 326 | 291 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 82 | Value | 01:09:26.817 | 250009 |  | 765 | 476 | 289 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 83 | Value | 01:21:42.767 | 294166 |  | 503 | 792 | 289 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 84 | Value | 01:56:52.767 | 420766 |  | 32 | 321 | 289 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 85 | Value | 03:41:43.067 | 798184 |  | 449 | 738 | 289 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 86 | Value | 03:46:10.967 | 814258 |  | 393 | 682 | 289 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 87 | Value | 01:27:38.100 | 315486 |  | 32 | 320 | 288 | UNSTABLE READINGS (digits flicker here, not reliable); POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 88 | Value | 03:41:51.983 | 798719 |  | 628 | 341 | 287 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 89 | Value | 03:47:00.967 | 817258 |  | 347 | 633 | 286 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 90 | Value | 02:27:32.550 | 531153 |  | 267 | 552 | 285 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 91 | Value | 01:09:18.833 | 249530 |  | 369 | 653 | 284 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 92 | Value | 01:29:15.767 | 321346 |  | 500 | 784 | 284 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 93 | Value | 03:43:51.967 | 805918 |  | 530 | 247 | 283 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 94 | Value | 01:18:17.183 | 281831 |  | 2 | 282 | 280 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 95 | Value | 03:08:24.467 | 678268 |  | 471 | 751 | 280 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 96 | Value | 03:09:35.467 | 682528 |  | 380 | 660 | 280 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 97 | Drift | 01:09:07.817 | 248869 | -1 | 397 | 607 | 210 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 98 | Drift | 01:11:29.817 | 257389 | -1 | 479 | 272 | 207 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 99 | Drift | 03:39:24.067 | 789844 | -1 | 185 | 392 | 207 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 100 | Drift | 01:09:14.833 | 249290 | +1 | 582 | 377 | 205 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 101 | Drift | 00:56:15.850 | 202551 | +1 | 301 | 495 | 194 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 102 | Drift | 01:12:01.817 | 259309 | -1 | 249 | 436 | 187 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 103 | Drift | 01:06:43.833 | 240230 | +1 | 477 | 296 | 181 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 104 | Drift | 03:37:36.067 | 783364 | -1 | 179 | 360 | 181 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 105 | Drift | 01:06:27.817 | 239269 | -1 | 281 | 455 | 174 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 106 | Drift | 01:06:15.833 | 238550 | +1 | 520 | 351 | 169 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 107 | Drift | 03:42:51.983 | 802319 | +1 | 794 | 626 | 168 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 108 | Drift | 01:11:33.833 | 257630 | +1 | 402 | 259 | 143 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 109 | Drift | 01:18:34.767 | 282886 | -2 | 261 | 401 | 140 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 110 | Drift | 00:53:57.850 | 194271 | +1 | 508 | 373 | 135 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 111 | Drift | 02:45:54.517 | 597271 | +1 | 347 | 482 | 135 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 112 | Drift | 02:48:41.500 | 607290 | -1 | 328 | 463 | 135 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 113 | Drift | 00:56:55.833 | 204950 | -1 | 257 | 388 | 131 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 114 | Drift | 02:47:44.500 | 603870 | -1 | 437 | 306 | 131 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 115 | Drift | 01:12:16.833 | 260210 | +1 | 371 | 245 | 126 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 116 | Drift | 02:23:07.550 | 515253 | -1 | 167 | 289 | 122 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 117 | Drift | 02:12:14.633 | 476078 | +1 | 397 | 279 | 118 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 118 | Drift | 02:43:12.500 | 587550 | -1 | 308 | 425 | 117 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 119 | Drift | 01:05:17.833 | 235070 | -1 | 207 | 322 | 115 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 120 | Drift | 01:06:56.850 | 241011 | +2 | 364 | 250 | 114 | phase moved +2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 121 | Drift | 02:09:06.667 | 464800 | -1 | 381 | 272 | 109 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 122 | Drift | 01:06:11.833 | 238310 | -1 | 258 | 365 | 107 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 123 | Drift | 03:34:20.067 | 771604 | -1 | 337 | 230 | 107 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 124 | Drift | 00:52:48.833 | 190130 | -1 | 385 | 490 | 105 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 125 | Drift | 02:53:00.517 | 622831 | +1 | 508 | 403 | 105 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 126 | Drift | 03:33:57.067 | 770224 | -1 | 209 | 314 | 105 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 127 | Drift | 00:59:02.833 | 212570 | -1 | 311 | 411 | 100 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 128 | Drift | 02:49:11.517 | 609091 | +1 | 332 | 430 | 98 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 129 | Drift | 00:54:24.850 | 195891 | +1 | 465 | 562 | 97 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 130 | Drift | 02:46:20.500 | 598830 | -1 | 346 | 443 | 97 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 131 | Drift | 02:45:56.500 | 597390 | -1 | 298 | 393 | 95 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 132 | Drift | 01:10:03.833 | 252230 | +1 | 449 | 356 | 93 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 133 | Drift | 02:23:25.550 | 516333 | -1 | 168 | 260 | 92 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 134 | Drift | 02:46:06.517 | 597991 | +1 | 374 | 283 | 91 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 135 | Drift | 01:10:05.817 | 252349 | -1 | 387 | 297 | 90 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 136 | Drift | 00:56:17.833 | 202670 | -1 | 329 | 418 | 89 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 137 | Drift | 02:38:30.550 | 570633 | +1 | 362 | 273 | 89 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 138 | Drift | 02:43:22.500 | 588150 | -1 | 251 | 340 | 89 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 139 | Drift | 01:07:49.817 | 244189 | -1 | 255 | 342 | 87 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 140 | Drift | 00:53:12.850 | 191571 | +1 | 383 | 299 | 84 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 141 | Drift | 01:08:45.833 | 247550 | +1 | 350 | 434 | 84 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 142 | Drift | 02:10:21.667 | 469300 | -1 | 372 | 288 | 84 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 143 | Drift | 03:35:04.083 | 774245 | +1 | 266 | 182 | 84 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 144 | Drift | 02:38:03.550 | 569013 | +1 | 329 | 246 | 83 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 145 | Drift | 01:08:52.817 | 247969 | -1 | 426 | 344 | 82 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 146 | Drift | 03:42:58.967 | 802738 | -1 | 236 | 318 | 82 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 147 | Drift | 02:10:29.667 | 469780 | -1 | 405 | 325 | 80 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 148 | Drift | 01:07:23.817 | 242629 | -1 | 228 | 305 | 77 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 149 | Drift | 02:09:02.683 | 464561 | +1 | 679 | 602 | 77 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 150 | Drift | 01:07:41.833 | 243710 | +1 | 470 | 396 | 74 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 151 | Drift | 01:12:07.833 | 259670 | +1 | 287 | 360 | 73 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 152 | Drift | 02:45:32.500 | 595950 | -1 | 386 | 457 | 71 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 153 | Drift | 00:58:39.850 | 211191 | +1 | 342 | 276 | 66 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 154 | Drift | 01:03:33.850 | 228831 | +1 | 320 | 254 | 66 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 155 | Drift | 01:11:01.817 | 255709 | -1 | 205 | 271 | 66 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 156 | Drift | 03:37:34.083 | 783245 | +1 | 277 | 211 | 66 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 157 | Drift | 01:04:08.850 | 230931 | +1 | 342 | 277 | 65 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 158 | Jump | 03:41:50.983 | 798659 | -5 | 693 | 628 | 65 | phase moved -5 frames and stayed: not continuous here |
| 159 | Drift | 01:09:05.833 | 248750 | +1 | 570 | 506 | 64 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 160 | Drift | 01:10:30.817 | 253849 | -1 | 279 | 343 | 64 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 161 | Drift | 01:10:46.833 | 254810 | +1 | 290 | 353 | 63 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 162 | Drift | 01:11:03.833 | 255830 | +1 | 292 | 355 | 63 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 163 | Drift | 01:12:13.817 | 260029 | -1 | 258 | 321 | 63 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 164 | Drift | 02:09:24.667 | 465880 | -1 | 330 | 393 | 63 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 165 | Drift | 02:43:27.517 | 588451 | +1 | 310 | 247 | 63 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 166 | Drift | 01:10:28.833 | 253730 | +1 | 317 | 256 | 61 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 167 | Drift | 00:59:14.850 | 213291 | +1 | 351 | 411 | 60 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 168 | Drift | 02:11:45.683 | 474341 | +1 | 415 | 355 | 60 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 169 | Drift | 02:23:05.567 | 515134 | +1 | 387 | 327 | 60 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 170 | Drift | 02:20:59.550 | 507573 | -1 | 221 | 162 | 59 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 171 | Drift | 01:01:31.850 | 221511 | +1 | 325 | 268 | 57 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 172 | Drift | 01:01:33.833 | 221630 | -1 | 269 | 326 | 57 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 173 | Drift | 02:47:42.517 | 603751 | +1 | 373 | 317 | 56 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 174 | Drift | 03:35:49.067 | 776944 | -1 | 216 | 270 | 54 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 175 | Drift | 00:59:18.833 | 213530 | -1 | 230 | 283 | 53 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 176 | Drift | 02:44:46.517 | 593191 | +1 | 295 | 348 | 53 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 177 | Drift | 02:09:52.667 | 467560 | -1 | 298 | 350 | 52 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 178 | Drift | 02:37:56.550 | 568593 | +1 | 260 | 312 | 52 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 179 | Drift | 02:38:05.533 | 569132 | -1 | 309 | 257 | 52 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 180 | Drift | 01:10:09.817 | 252589 | -1 | 281 | 332 | 51 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 181 | Drift | 02:53:30.500 | 624630 | -1 | 359 | 308 | 51 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 182 | Drift | 01:04:11.833 | 231110 | -1 | 272 | 222 | 50 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 183 | Drift | 02:46:39.500 | 599970 | -1 | 400 | 350 | 50 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 184 | Drift | 02:43:53.517 | 590011 | +1 | 239 | 287 | 48 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 185 | Drift | 01:04:58.850 | 233931 | +1 | 317 | 270 | 47 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 186 | Drift | 01:06:29.833 | 239390 | +1 | 383 | 336 | 47 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 187 | Drift | 02:21:21.550 | 508893 | -1 | 169 | 216 | 47 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 188 | Drift | 02:21:18.567 | 508714 | +1 | 151 | 197 | 46 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 189 | Drift | 02:45:10.517 | 594631 | +1 | 235 | 281 | 46 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 190 | Drift | 02:45:43.517 | 596611 | +1 | 414 | 368 | 46 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 191 | Drift | 00:54:26.833 | 196010 | -1 | 400 | 445 | 45 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 192 | Drift | 03:37:21.067 | 782464 | -1 | 202 | 247 | 45 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 193 | Drift | 02:08:18.683 | 461921 | +1 | 251 | 294 | 43 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 194 | Drift | 03:35:45.083 | 776705 | +1 | 247 | 204 | 43 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 195 | Drift | 00:52:36.850 | 189411 | +1 | 339 | 297 | 42 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 196 | Drift | 01:10:07.833 | 252470 | +1 | 341 | 299 | 42 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 197 | Drift | 02:54:46.500 | 629190 | -1 | 422 | 464 | 42 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 198 | Drift | 01:04:37.833 | 232670 | -1 | 341 | 300 | 41 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 199 | Drift | 01:09:27.833 | 250070 | +1 | 476 | 435 | 41 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 200 | Drift | 01:12:19.800 | 260388 | -2 | 354 | 313 | 41 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 201 | Jump | 01:56:07.700 | 418062 | -4 | 422 | 381 | 41 | phase moved -4 frames and stayed: not continuous here |
| 202 | Drift | 03:32:44.083 | 765845 | +1 | 200 | 241 | 41 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 203 | Drift | 01:08:23.833 | 246230 | +1 | 314 | 274 | 40 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 204 | Drift | 02:31:26.533 | 545192 | -1 | 365 | 405 | 40 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 205 | Drift | 01:05:00.833 | 234050 | -1 | 275 | 314 | 39 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 206 | Drift | 01:03:35.833 | 228950 | -1 | 237 | 275 | 38 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 207 | Drift | 02:08:37.667 | 463060 | -1 | 395 | 433 | 38 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 208 | Drift | 02:55:34.467 | 632068 | -2 | 391 | 353 | 38 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 209 | Drift | 00:53:14.833 | 191690 | -1 | 343 | 380 | 37 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 210 | Drift | 01:00:03.833 | 216230 | -1 | 270 | 307 | 37 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 211 | Drift | 01:56:20.717 | 418843 | +1 | 219 | 256 | 37 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 212 | Drift | 02:44:39.517 | 592771 | +1 | 364 | 327 | 37 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 213 | Drift | 02:44:41.500 | 592890 | -1 | 298 | 335 | 37 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 214 | Drift | 01:02:58.833 | 226730 | -1 | 276 | 312 | 36 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 215 | Drift | 02:08:23.667 | 462220 | -1 | 236 | 272 | 36 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 216 | Drift | 03:37:13.083 | 781985 | +1 | 264 | 229 | 35 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 217 | Drift | 01:09:43.833 | 251030 | +1 | 394 | 360 | 34 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 218 | Drift | 02:10:27.683 | 469661 | +1 | 403 | 369 | 34 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 219 | Jump | 02:11:57.617 | 475057 | -3 | 341 | 375 | 34 | phase moved -3 frames and stayed: not continuous here |
| 220 | Drift | 02:39:39.517 | 574771 | -1 | 239 | 273 | 34 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 221 | Drift | 02:39:42.533 | 574952 | +1 | 287 | 253 | 34 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 222 | Drift | 02:45:45.500 | 596730 | -1 | 390 | 424 | 34 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 223 | Drift | 01:08:28.833 | 246530 | +1 | 276 | 309 | 33 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 224 | Drift | 01:09:37.817 | 250669 | -1 | 422 | 455 | 33 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 225 | Jump | 02:07:44.683 | 459881 | +4 | 269 | 236 | 33 | phase moved +4 frames and stayed: not continuous here |
| 226 | Drift | 02:46:18.517 | 598711 | +1 | 367 | 400 | 33 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 227 | Drift | 03:36:08.067 | 778084 | -1 | 224 | 257 | 33 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 228 | Drift | 00:52:29.833 | 188990 | -1 | 279 | 311 | 32 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 229 | Drift | 00:59:00.850 | 212451 | +1 | 257 | 288 | 31 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 230 | Drift | 02:09:00.667 | 464440 | -1 | 343 | 373 | 30 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 231 | Drift | 02:09:40.683 | 466841 | +1 | 279 | 309 | 30 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 232 | Drift | 02:39:26.517 | 573991 | -1 | 347 | 317 | 30 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 233 | Drift | 02:43:45.517 | 589531 | +1 | 298 | 268 | 30 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 234 | Drift | 01:08:41.817 | 247309 | -1 | 316 | 345 | 29 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 235 | Drift | 01:56:22.700 | 418962 | -1 | 296 | 267 | 29 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 236 | Drift | 02:42:53.517 | 586411 | -1 | 280 | 309 | 29 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 237 | Drift | 00:53:59.833 | 194390 | -1 | 314 | 286 | 28 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 238 | Drift | 01:06:13.817 | 238429 | -1 | 412 | 384 | 28 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 239 | Drift | 02:21:47.550 | 510453 | -1 | 156 | 184 | 28 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 240 | Drift | 02:23:18.567 | 515914 | +1 | 228 | 200 | 28 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 241 | Drift | 01:05:22.850 | 235371 | +1 | 311 | 338 | 27 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 242 | Drift | 02:11:17.683 | 472661 | +1 | 248 | 275 | 27 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 243 | Drift | 02:39:44.517 | 575071 | -1 | 239 | 266 | 27 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 244 | Drift | 01:04:41.850 | 232911 | +1 | 253 | 227 | 26 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 245 | Drift | 01:08:26.817 | 246409 | -1 | 291 | 317 | 26 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 246 | Drift | 02:10:54.667 | 471280 | -1 | 311 | 337 | 26 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 247 | Jump | 02:15:30.567 | 487834 | -3 | 370 | 396 | 26 | phase moved -3 frames and stayed: not continuous here |
| 248 | Drift | 02:39:29.533 | 574172 | +1 | 353 | 327 | 26 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 249 | Drift | 02:39:37.533 | 574652 | +1 | 255 | 281 | 26 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 250 | Drift | 01:06:52.817 | 240769 | -1 | 267 | 292 | 25 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 251 | Drift | 01:01:16.833 | 220610 | -1 | 268 | 244 | 24 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 252 | Drift | 01:05:15.850 | 234951 | +1 | 234 | 210 | 24 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 253 | Drift | 01:08:02.833 | 244970 | +1 | 300 | 276 | 24 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 254 | Drift | 02:21:53.550 | 510813 | -1 | 201 | 225 | 24 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 255 | Drift | 03:39:22.083 | 789725 | +1 | 380 | 356 | 24 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 256 | Drift | 00:53:41.833 | 193310 | -1 | 398 | 375 | 23 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 257 | Drift | 01:06:06.850 | 238011 | +1 | 315 | 292 | 23 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 258 | Drift | 01:10:19.833 | 253190 | +1 | 313 | 336 | 23 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 259 | Drift | 02:08:10.683 | 461441 | +1 | 271 | 248 | 23 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 260 | Drift | 02:08:33.683 | 462821 | +1 | 334 | 357 | 23 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 261 | Drift | 02:49:13.500 | 609210 | -1 | 325 | 302 | 23 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 262 | Drift | 01:03:44.850 | 229491 | +1 | 255 | 233 | 22 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 263 | Drift | 01:09:16.817 | 249409 | -1 | 359 | 381 | 22 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 264 | Drift | 01:10:26.817 | 253609 | -1 | 313 | 335 | 22 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 265 | Drift | 02:07:48.667 | 460120 | -1 | 351 | 373 | 22 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 266 | Drift | 02:09:48.683 | 467321 | +1 | 366 | 344 | 22 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 267 | Drift | 02:36:50.533 | 564632 | -1 | 217 | 239 | 22 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 268 | Drift | 03:36:06.083 | 777965 | +1 | 243 | 221 | 22 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 269 | Drift | 01:06:59.817 | 241189 | -1 | 254 | 233 | 21 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 270 | Drift | 02:11:25.667 | 473140 | -1 | 283 | 262 | 21 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 271 | Drift | 02:12:17.617 | 476257 | -1 | 263 | 284 | 21 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 272 | Drift | 02:42:51.533 | 586292 | +1 | 265 | 286 | 21 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 273 | Drift | 03:33:55.083 | 770105 | +1 | 198 | 219 | 21 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 274 | Drift | 03:34:15.083 | 771305 | +1 | 239 | 218 | 21 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 275 | Drift | 01:01:26.850 | 221211 | +1 | 269 | 249 | 20 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 276 | Drift | 01:02:35.833 | 225350 | -1 | 413 | 394 | 19 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 277 | Drift | 02:09:14.683 | 465281 | +1 | 371 | 390 | 19 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 278 | Drift | 02:46:37.517 | 599851 | +1 | 400 | 419 | 19 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 279 | Drift | 01:03:26.833 | 228410 | -1 | 300 | 282 | 18 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 280 | Drift | 01:07:35.817 | 243349 | -1 | 276 | 258 | 18 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 281 | Drift | 02:10:39.667 | 470380 | -1 | 351 | 333 | 18 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 282 | Drift | 02:20:57.567 | 507454 | +1 | 214 | 232 | 18 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 283 | Drift | 02:11:11.683 | 472301 | +1 | 269 | 286 | 17 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 284 | Drift | 02:43:48.500 | 589710 | -1 | 249 | 266 | 17 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 285 | Drift | 02:45:17.517 | 595051 | +1 | 279 | 262 | 17 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 286 | Drift | 00:54:17.850 | 195471 | +1 | 367 | 383 | 16 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 287 | Drift | 01:01:28.833 | 221330 | -1 | 253 | 269 | 16 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 288 | Drift | 01:01:39.833 | 221990 | -1 | 274 | 258 | 16 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 289 | Drift | 01:07:52.833 | 244370 | +1 | 390 | 406 | 16 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 290 | Jump | 01:59:46.617 | 431197 | -3 | 502 | 518 | 16 | phase moved -3 frames and stayed: not continuous here |
| 291 | Drift | 02:54:43.517 | 629011 | +1 | 302 | 286 | 16 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 292 | Drift | 01:01:13.850 | 220431 | +1 | 278 | 263 | 15 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 293 | Drift | 01:03:48.833 | 229730 | -1 | 275 | 260 | 15 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 294 | Drift | 02:45:58.517 | 597511 | +1 | 332 | 347 | 15 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 295 | Drift | 01:01:46.833 | 222410 | -1 | 296 | 310 | 14 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 296 | Drift | 01:06:40.817 | 240049 | -1 | 330 | 344 | 14 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 297 | Drift | 02:08:07.667 | 461260 | -1 | 265 | 251 | 14 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 298 | Drift | 02:11:50.667 | 474640 | -1 | 338 | 324 | 14 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 299 | Drift | 02:39:31.517 | 574291 | -1 | 258 | 272 | 14 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 300 | Drift | 02:46:09.500 | 598170 | -1 | 317 | 331 | 14 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 301 | Drift | 03:37:17.067 | 782224 | -1 | 212 | 198 | 14 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 302 | Drift | 02:08:04.683 | 461081 | +1 | 268 | 255 | 13 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 303 | Drift | 02:20:54.550 | 507273 | -1 | 186 | 199 | 13 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 304 | Drift | 02:22:05.550 | 511533 | -1 | 220 | 233 | 13 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 305 | Drift | 02:43:29.500 | 588570 | -1 | 281 | 268 | 13 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 306 | Drift | 02:45:30.517 | 595831 | +1 | 328 | 341 | 13 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 307 | Drift | 01:08:12.817 | 245569 | -1 | 324 | 312 | 12 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 308 | Drift | 02:43:20.517 | 588031 | +1 | 283 | 295 | 12 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 309 | Drift | 01:04:47.833 | 233270 | -1 | 230 | 219 | 11 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 310 | Drift | 01:07:26.833 | 242810 | +1 | 311 | 322 | 11 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 311 | Drift | 02:21:44.567 | 510274 | +1 | 185 | 174 | 11 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 312 | Drift | 02:48:39.517 | 607171 | +1 | 373 | 362 | 11 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 313 | Drift | 00:56:53.850 | 204831 | +1 | 367 | 357 | 10 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 314 | Drift | 01:07:58.817 | 244729 | -1 | 290 | 280 | 10 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 315 | Drift | 01:59:20.667 | 429640 | -2 | 570 | 560 | 10 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 316 | Drift | 02:08:43.683 | 463421 | +1 | 297 | 307 | 10 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 317 | Drift | 02:53:02.500 | 622950 | -1 | 354 | 344 | 10 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 318 | Drift | 03:32:46.067 | 765964 | -1 | 205 | 195 | 10 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 319 | Drift | 03:37:19.083 | 782345 | +1 | 207 | 197 | 10 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 320 | Drift | 01:02:52.850 | 226371 | +1 | 330 | 339 | 9 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 321 | Drift | 02:21:49.567 | 510574 | +1 | 206 | 197 | 9 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 322 | Drift | 02:45:24.500 | 595470 | -1 | 281 | 290 | 9 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 323 | Drift | 03:38:32.067 | 786724 | -1 | 195 | 204 | 9 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 324 | Drift | 01:00:01.850 | 216111 | +1 | 284 | 292 | 8 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 325 | Drift | 02:10:52.683 | 471161 | +1 | 336 | 328 | 8 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 326 | Drift | 02:11:13.667 | 472420 | -1 | 235 | 243 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 327 | Drift | 00:53:38.850 | 193131 | +1 | 362 | 355 | 7 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 328 | Drift | 01:08:32.817 | 246769 | -1 | 273 | 280 | 7 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 329 | Drift | 01:08:36.833 | 247010 | +1 | 321 | 314 | 7 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 330 | Drift | 01:09:51.817 | 251509 | -1 | 435 | 442 | 7 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 331 | Drift | 02:37:58.533 | 568712 | -1 | 266 | 273 | 7 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 332 | Drift | 00:52:16.850 | 188211 | +1 | 285 | 279 | 6 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 333 | Drift | 00:58:41.833 | 211310 | -1 | 350 | 344 | 6 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 334 | Drift | 01:04:23.850 | 231831 | +1 | 256 | 262 | 6 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 335 | Drift | 03:37:10.067 | 781804 | -1 | 215 | 221 | 6 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 336 | Drift | 01:03:24.850 | 228291 | +1 | 262 | 257 | 5 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 337 | Drift | 02:44:51.500 | 593490 | -1 | 277 | 282 | 5 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 338 | Drift | 03:35:06.067 | 774364 | -1 | 223 | 228 | 5 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 339 | Drift | 00:54:20.833 | 195650 | -1 | 331 | 327 | 4 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 340 | Drift | 01:05:24.833 | 235490 | -1 | 308 | 312 | 4 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 341 | Drift | 02:09:43.667 | 467020 | -1 | 305 | 309 | 4 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 342 | Drift | 02:38:32.533 | 570752 | -1 | 298 | 294 | 4 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 343 | Drift | 02:45:12.500 | 594750 | -1 | 259 | 263 | 4 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 344 | Drift | 02:46:01.500 | 597690 | -1 | 283 | 287 | 4 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 345 | Drift | 00:52:09.833 | 187790 | -1 | 298 | 295 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 346 | Drift | 01:01:35.850 | 221751 | +1 | 366 | 363 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 347 | Drift | 01:01:44.850 | 222291 | +1 | 273 | 276 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 348 | Drift | 01:07:03.833 | 241430 | +1 | 267 | 270 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 349 | Drift | 02:21:58.567 | 511114 | +1 | 207 | 204 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 350 | Drift | 02:43:58.500 | 590310 | -1 | 268 | 271 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 351 | Drift | 01:06:57.833 | 241070 | -1 | 250 | 248 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 352 | Drift | 02:08:53.683 | 464021 | +1 | 325 | 327 | 2 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 353 | Drift | 02:53:28.517 | 624511 | +1 | 331 | 333 | 2 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 354 | Drift | 03:37:08.083 | 781685 | +1 | 194 | 192 | 2 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 355 | Drift | 03:38:30.083 | 786605 | +1 | 227 | 225 | 2 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 356 | Drift | 01:02:30.850 | 225051 | +1 | 324 | 323 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 357 | Drift | 02:08:12.667 | 461560 | -1 | 236 | 237 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 358 | Drift | 02:08:51.667 | 463900 | -1 | 341 | 340 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 359 | Drift | 02:36:48.550 | 564513 | +1 | 242 | 241 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 360 | Gap | 00:00:00.000 | 0 |  |  |  |  | overlay unreadable for 187089 frames (3118.2 s) |
| 361 | Gap | 00:55:14.000 | 198840 |  |  |  |  | overlay unreadable for 127 frames (2.1 s) |
| 362 | Gap | 01:20:46.317 | 290779 |  |  |  |  | overlay unreadable for 471 frames (7.8 s) |
| 363 | Gap | 01:20:58.867 | 291532 |  |  |  |  | overlay unreadable for 1589 frames (26.5 s) |
| 364 | Gap | 01:58:29.817 | 426589 |  |  |  |  | overlay unreadable for 110 frames (1.8 s) |
| 365 | Gap | 02:10:05.000 | 468300 |  |  |  |  | overlay unreadable for 719 frames (12.0 s) |
| 366 | Gap | 02:10:32.567 | 469954 |  |  |  |  | overlay unreadable for 262 frames (4.4 s) |
| 367 | Gap | 03:11:34.783 | 689687 |  |  |  |  | overlay unreadable for 110 frames (1.8 s) |
| 368 | Gap | 03:11:40.467 | 690028 |  |  |  |  | overlay unreadable for 240 frames (4.0 s) |
| 369 | Gap | 03:11:47.467 | 690448 |  |  |  |  | overlay unreadable for 190 frames (3.2 s) |
| 370 | Gap | 03:11:52.100 | 690726 |  |  |  |  | overlay unreadable for 122 frames (2.0 s) |
| 371 | Gap | 03:11:54.467 | 690868 |  |  |  |  | overlay unreadable for 1020 frames (17.0 s) |
| 372 | Gap | 03:12:19.467 | 692368 |  |  |  |  | overlay unreadable for 244 frames (4.1 s) |
| 373 | Gap | 03:12:25.750 | 692745 |  |  |  |  | overlay unreadable for 149 frames (2.5 s) |
| 374 | Gap | 03:12:28.417 | 692905 |  |  |  |  | overlay unreadable for 67 frames (1.1 s) |
| 375 | Gap | 03:12:49.083 | 694145 |  |  |  |  | overlay unreadable for 74 frames (1.2 s) |
| 376 | Gap | 03:12:50.400 | 694224 |  |  |  |  | overlay unreadable for 64 frames (1.1 s) |
| 377 | Gap | 03:12:51.650 | 694299 |  |  |  |  | overlay unreadable for 99 frames (1.6 s) |
| 378 | Gap | 03:12:55.017 | 694501 |  |  |  |  | overlay unreadable for 387 frames (6.5 s) |
| 379 | Gap | 03:13:04.917 | 695095 |  |  |  |  | overlay unreadable for 337 frames (5.6 s) |
| 380 | Gap | 03:13:12.200 | 695532 |  |  |  |  | overlay unreadable for 248 frames (4.1 s) |
| 381 | Gap | 03:13:16.867 | 695812 |  |  |  |  | overlay unreadable for 76 frames (1.3 s) |
| 382 | Gap | 03:13:21.517 | 696091 |  |  |  |  | overlay unreadable for 282 frames (4.7 s) |
| 383 | Gap | 03:13:35.467 | 696928 |  |  |  |  | overlay unreadable for 136 frames (2.3 s) |
| 384 | Gap | 03:13:40.533 | 697232 |  |  |  |  | overlay unreadable for 89 frames (1.5 s) |
| 385 | Gap | 03:13:48.150 | 697689 |  |  |  |  | overlay unreadable for 123 frames (2.0 s) |
| 386 | Gap | 03:13:51.567 | 697894 |  |  |  |  | overlay unreadable for 120 frames (2.0 s) |
| 387 | Gap | 03:13:54.433 | 698066 |  |  |  |  | overlay unreadable for 180 frames (3.0 s) |
| 388 | Gap | 03:13:59.017 | 698341 |  |  |  |  | overlay unreadable for 145 frames (2.4 s) |
| 389 | Gap | 03:14:01.750 | 698505 |  |  |  |  | overlay unreadable for 101 frames (1.7 s) |
| 390 | Gap | 03:14:13.133 | 699188 |  |  |  |  | overlay unreadable for 225 frames (3.8 s) |
| 391 | Gap | 03:14:17.067 | 699424 |  |  |  |  | overlay unreadable for 202 frames (3.4 s) |
| 392 | Gap | 03:14:23.217 | 699793 |  |  |  |  | overlay unreadable for 87 frames (1.4 s) |
| 393 | Gap | 03:14:29.433 | 700166 |  |  |  |  | overlay unreadable for 74 frames (1.2 s) |
| 394 | Gap | 03:14:31.433 | 700286 |  |  |  |  | overlay unreadable for 302 frames (5.0 s) |
| 395 | Gap | 03:14:41.750 | 700905 |  |  |  |  | overlay unreadable for 281 frames (4.7 s) |
| 396 | Gap | 03:14:48.083 | 701285 |  |  |  |  | overlay unreadable for 191 frames (3.2 s) |
| 397 | Gap | 03:14:51.433 | 701486 |  |  |  |  | overlay unreadable for 189 frames (3.1 s) |
| 398 | Gap | 03:15:00.417 | 702025 |  |  |  |  | overlay unreadable for 241 frames (4.0 s) |
| 399 | Gap | 03:15:04.717 | 702283 |  |  |  |  | overlay unreadable for 99 frames (1.6 s) |
| 400 | Gap | 03:15:07.417 | 702445 |  |  |  |  | overlay unreadable for 181 frames (3.0 s) |
| 401 | Gap | 03:15:11.433 | 702686 |  |  |  |  | overlay unreadable for 180 frames (3.0 s) |
| 402 | Gap | 03:15:15.433 | 702926 |  |  |  |  | overlay unreadable for 660 frames (11.0 s) |
| 403 | Gap | 03:15:27.433 | 703646 |  |  |  |  | overlay unreadable for 203 frames (3.4 s) |
| 404 | Gap | 03:15:32.167 | 703930 |  |  |  |  | overlay unreadable for 195 frames (3.2 s) |
| 405 | Gap | 03:15:36.433 | 704186 |  |  |  |  | overlay unreadable for 248 frames (4.1 s) |
| 406 | Gap | 03:15:40.583 | 704435 |  |  |  |  | overlay unreadable for 231 frames (3.9 s) |
| 407 | Gap | 03:15:45.433 | 704726 |  |  |  |  | overlay unreadable for 120 frames (2.0 s) |
| 408 | Gap | 03:15:53.417 | 705205 |  |  |  |  | overlay unreadable for 128 frames (2.1 s) |
| 409 | Gap | 03:15:58.700 | 705522 |  |  |  |  | overlay unreadable for 342 frames (5.7 s) |
| 410 | Gap | 03:16:05.400 | 705924 |  |  |  |  | overlay unreadable for 181 frames (3.0 s) |
| 411 | Gap | 03:16:08.450 | 706107 |  |  |  |  | overlay unreadable for 148 frames (2.5 s) |
| 412 | Gap | 03:16:12.400 | 706344 |  |  |  |  | overlay unreadable for 180 frames (3.0 s) |
| 413 | Gap | 03:16:15.850 | 706551 |  |  |  |  | overlay unreadable for 62 frames (1.0 s) |
| 414 | Gap | 03:16:20.017 | 706801 |  |  |  |  | overlay unreadable for 142 frames (2.4 s) |
| 415 | Gap | 03:16:25.017 | 707101 |  |  |  |  | overlay unreadable for 106 frames (1.8 s) |
| 416 | Gap | 03:16:29.967 | 707398 |  |  |  |  | overlay unreadable for 74 frames (1.2 s) |
| 417 | Gap | 03:16:35.000 | 707700 |  |  |  |  | overlay unreadable for 79 frames (1.3 s) |
| 418 | Gap | 03:16:45.217 | 708313 |  |  |  |  | overlay unreadable for 391 frames (6.5 s) |
| 419 | Gap | 03:17:23.000 | 710580 |  |  |  |  | overlay unreadable for 88 frames (1.5 s) |
| 420 | Gap | 03:17:24.650 | 710679 |  |  |  |  | overlay unreadable for 286 frames (4.8 s) |
| 421 | Gap | 03:17:29.483 | 710969 |  |  |  |  | overlay unreadable for 429 frames (7.2 s) |
| 422 | Gap | 03:17:36.667 | 711400 |  |  |  |  | overlay unreadable for 117 frames (1.9 s) |
| 423 | Gap | 03:17:40.283 | 711617 |  |  |  |  | overlay unreadable for 1567 frames (26.1 s) |
| 424 | Gap | 03:18:09.400 | 713364 |  |  |  |  | overlay unreadable for 120 frames (2.0 s) |
| 425 | Gap | 03:18:13.400 | 713604 |  |  |  |  | overlay unreadable for 480 frames (8.0 s) |
| 426 | Gap | 03:18:23.400 | 714204 |  |  |  |  | overlay unreadable for 1921 frames (32.0 s) |
| 427 | Gap | 03:18:55.733 | 716144 |  |  |  |  | overlay unreadable for 151 frames (2.5 s) |
| 428 | Gap | 03:18:58.267 | 716296 |  |  |  |  | overlay unreadable for 1148 frames (19.1 s) |
| 429 | Gap | 03:19:17.567 | 717454 |  |  |  |  | overlay unreadable for 1064 frames (17.7 s) |
| 430 | Gap | 03:19:35.400 | 718524 |  |  |  |  | overlay unreadable for 3240 frames (54.0 s) |
| 431 | Gap | 03:20:30.400 | 721824 |  |  |  |  | overlay unreadable for 120 frames (2.0 s) |
| 432 | Gap | 03:20:33.400 | 722004 |  |  |  |  | overlay unreadable for 120 frames (2.0 s) |
| 433 | Gap | 03:20:39.400 | 722364 |  |  |  |  | overlay unreadable for 120 frames (2.0 s) |
| 434 | Gap | 03:20:43.400 | 722604 |  |  |  |  | overlay unreadable for 489 frames (8.2 s) |
| 435 | Gap | 03:20:51.917 | 723115 |  |  |  |  | overlay unreadable for 209 frames (3.5 s) |
| 436 | Gap | 03:20:56.200 | 723372 |  |  |  |  | overlay unreadable for 972 frames (16.2 s) |
| 437 | Gap | 03:21:15.400 | 724524 |  |  |  |  | overlay unreadable for 180 frames (3.0 s) |
| 438 | Gap | 03:21:19.400 | 724764 |  |  |  |  | overlay unreadable for 2040 frames (34.0 s) |
| 439 | Gap | 03:22:04.550 | 727473 |  |  |  |  | overlay unreadable for 274 frames (4.6 s) |
| 440 | Gap | 03:22:13.400 | 728004 |  |  |  |  | overlay unreadable for 137 frames (2.3 s) |
| 441 | Gap | 03:22:15.833 | 728150 |  |  |  |  | overlay unreadable for 62 frames (1.0 s) |
| 442 | Gap | 03:22:21.483 | 728489 |  |  |  |  | overlay unreadable for 64 frames (1.1 s) |
| 443 | Gap | 03:22:23.283 | 728597 |  |  |  |  | overlay unreadable for 867 frames (14.4 s) |
| 444 | Gap | 03:22:37.983 | 729479 |  |  |  |  | overlay unreadable for 77 frames (1.3 s) |
| 445 | Gap | 03:22:40.250 | 729615 |  |  |  |  | overlay unreadable for 69 frames (1.1 s) |
| 446 | Gap | 03:22:42.400 | 729744 |  |  |  |  | overlay unreadable for 102 frames (1.7 s) |
| 447 | Gap | 03:22:45.833 | 729950 |  |  |  |  | overlay unreadable for 103 frames (1.7 s) |
| 448 | Gap | 03:22:47.633 | 730058 |  |  |  |  | overlay unreadable for 111 frames (1.9 s) |
| 449 | Gap | 03:22:49.533 | 730172 |  |  |  |  | overlay unreadable for 101 frames (1.7 s) |
| 450 | Gap | 03:22:51.300 | 730278 |  |  |  |  | overlay unreadable for 83 frames (1.4 s) |
| 451 | Gap | 03:22:53.033 | 730382 |  |  |  |  | overlay unreadable for 17556 frames (292.6 s) |
| 452 | Gap | 03:27:50.183 | 748211 |  |  |  |  | overlay unreadable for 79 frames (1.3 s) |
| 453 | Gap | 03:47:14.983 | 818099 |  |  |  |  | overlay unreadable for 62 frames (1.0 s) |
| 454 | Gap | 03:47:24.400 | 818664 |  |  |  |  | overlay unreadable for 79 frames (1.3 s) |
| 455 | Gap | 03:47:26.983 | 818819 |  |  |  |  | overlay unreadable for 78 frames (1.3 s) |
| 456 | Gap | 03:47:28.567 | 818914 |  |  |  |  | overlay unreadable for 113 frames (1.9 s) |
| 457 | Gap | 03:47:32.967 | 819178 |  |  |  |  | overlay unreadable for 69 frames (1.1 s) |
| 458 | Gap | 03:47:34.817 | 819289 |  |  |  |  | overlay unreadable for 150 frames (2.5 s) |
| 459 | Gap | 03:47:39.083 | 819545 |  |  |  |  | overlay unreadable for 119 frames (2.0 s) |
| 460 | Gap | 03:47:45.467 | 819928 |  |  |  |  | overlay unreadable for 63 frames (1.1 s) |
| 461 | Gap | 03:47:52.267 | 820336 |  |  |  |  | overlay unreadable for 71 frames (1.2 s) |
| 462 | Gap | 03:47:54.683 | 820481 |  |  |  |  | overlay unreadable for 164 frames (2.7 s) |
| 463 | Gap | 03:48:05.217 | 821113 |  |  |  |  | overlay unreadable for 284 frames (4.7 s) |
| 464 | Gap | 03:48:15.833 | 821750 |  |  |  |  | overlay unreadable for 191 frames (3.2 s) |
| 465 | Gap | 03:48:29.350 | 822561 |  |  |  |  | overlay unreadable for 90 frames (1.5 s) |
| 466 | Gap | 03:48:35.750 | 822945 |  |  |  |  | overlay unreadable for 100 frames (1.7 s) |
| 467 | Gap | 03:48:41.633 | 823298 |  |  |  |  | overlay unreadable for 77 frames (1.3 s) |
| 468 | Gap | 03:49:00.333 | 824420 |  |  |  |  | overlay unreadable for 69 frames (1.1 s) |
| 469 | Gap | 03:49:22.967 | 825778 |  |  |  |  | overlay unreadable for 70 frames (1.2 s) |
| 470 | Gap | 03:49:24.283 | 825857 |  |  |  |  | overlay unreadable for 97 frames (1.6 s) |
| 471 | Gap | 03:49:31.567 | 826294 |  |  |  |  | overlay unreadable for 108 frames (1.8 s) |
| 472 | Gap | 03:49:40.983 | 826859 |  |  |  |  | overlay unreadable for 86 frames (1.4 s) |
| 473 | Gap | 03:49:44.367 | 827062 |  |  |  |  | overlay unreadable for 168 frames (2.8 s) |
| 474 | Gap | 03:49:48.750 | 827325 |  |  |  |  | overlay unreadable for 64 frames (1.1 s) |
| 475 | Gap | 03:50:04.967 | 828298 |  |  |  |  | overlay unreadable for 62 frames (1.0 s) |
| 476 | Gap | 03:50:13.750 | 828825 |  |  |  |  | overlay unreadable for 70 frames (1.2 s) |
| 477 | Gap | 03:50:18.000 | 829080 |  |  |  |  | overlay unreadable for 115 frames (1.9 s) |
| 478 | Gap | 03:50:29.600 | 829776 |  |  |  |  | overlay unreadable for 128 frames (2.1 s) |
| 479 | Gap | 03:50:37.117 | 830227 |  |  |  |  | overlay unreadable for 238 frames (4.0 s) |
| 480 | Gap | 03:50:46.100 | 830766 |  |  |  |  | overlay unreadable for 96 frames (1.6 s) |
| 481 | Gap | 03:50:50.667 | 831040 |  |  |  |  | overlay unreadable for 76 frames (1.3 s) |
| 482 | Gap | 03:50:59.233 | 831554 |  |  |  |  | overlay unreadable for 193 frames (3.2 s) |
| 483 | Gap | 03:51:03.400 | 831804 |  |  |  |  | overlay unreadable for 477 frames (8.0 s) |
| 484 | Gap | 03:51:11.483 | 832289 |  |  |  |  | overlay unreadable for 127 frames (2.1 s) |
| 485 | Gap | 03:51:21.000 | 832860 |  |  |  |  | overlay unreadable for 80 frames (1.3 s) |
| 486 | Gap | 03:51:22.683 | 832961 |  |  |  |  | overlay unreadable for 129 frames (2.1 s) |
| 487 | Gap | 03:51:45.317 | 834319 |  |  |  |  | overlay unreadable for 258 frames (4.3 s) |
| 488 | Gap | 03:51:56.267 | 834976 |  |  |  |  | overlay unreadable for 87 frames (1.4 s) |
| 489 | Gap | 03:51:59.367 | 835162 |  |  |  |  | overlay unreadable for 97 frames (1.6 s) |
| 490 | Gap | 03:52:16.867 | 836212 |  |  |  |  | overlay unreadable for 61 frames (1.0 s) |
| 491 | Gap | 03:52:18.700 | 836322 |  |  |  |  | overlay unreadable for 78 frames (1.3 s) |
| 492 | Gap | 03:52:20.333 | 836420 |  |  |  |  | overlay unreadable for 146 frames (2.4 s) |
| 493 | Gap | 03:52:34.333 | 837260 |  |  |  |  | overlay unreadable for 104 frames (1.7 s) |
| 494 | Gap | 03:52:43.167 | 837790 |  |  |  |  | overlay unreadable for 91 frames (1.5 s) |
