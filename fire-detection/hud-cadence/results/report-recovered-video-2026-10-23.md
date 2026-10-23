# hud-cadence report: D:/Coding/Minecraft/FireCracking/misc/dream/recovered-video.mkv

561619 frames at 60 fps; overlay readable on 457383 (81.4 %); 707 findings.

## Jumps (phase moved >= 3 frames and stayed), in time order

| time | frame | shift | before | after | \|d\| | flags |
|---|---|---|---|---|---|---|
| 00:12:21.850 | 44511 | -4 | 92 | 113 | 21 |  |
| 00:17:03.467 | 61408 | -19 | 103 | 120 | 17 |  |
| 00:47:38.533 | 171512 | +13 | 231 | 221 | 10 |  |

## Inside each Jolt break

Jolt report: `results/jolt-2.5-recovered-video-2026-10-22.json`. Each break lists every pair of consecutive FPS changes overlapping Jolt's bracket, plus one
pair of context on each side. A pair should be a whole number of seconds (60 frames); the deviation is the
remainder (negative = frames missing). Cadence missing = minus the sum over the inside pairs, counted modulo one
second (±2 frames read error). Agree = the two counts match modulo one second within ±3 frames.

| # | kind | bracket (frames) | time | Jolt missing | cadence missing | agree |
|---|---|---|---|---|---|---|
| 1 | removed | 5870 – 6083 | 00:01:37.833 | 15 f | no readings | n/a |
| 2 | removed | 61270 – 61409 | 00:17:01.167 | 17 f | 19 f (±2) | yes |
| 3 | removed | 171397 – 171498 | 00:47:36.617 | 46 f | 47 f (±2; +13 modulo 1 s) | yes |

### Break 1: removed, frames 5870 – 6083 (00:01:37.833 – 00:01:41.383)

| from | to | spacing | deviation | before | after | where | note |
|---|---|---|---|---|---|---|---|
| 734 | 794 | 60 | 0 | 159 | 174 | context |  |
| 794 | 30271 | 29477 | +17 | 174 | 115 | inside | spans 491.3 s: crosses an unreadable stretch, not counted |
| 30271 | 30295 | 24 | +24 | 115 | 134 | context | **24 frames added** |

### Break 2: removed, frames 61270 – 61409 (00:17:01.167 – 00:17:03.483)

| from | to | spacing | deviation | before | after | where | note |
|---|---|---|---|---|---|---|---|
| 61187 | 61247 | 60 | 0 | 109 | 94 | context |  |
| 61247 | 61307 | 60 | 0 | 94 | 106 | inside |  |
| 61307 | 61367 | 60 | 0 | 106 | 103 | inside |  |
| 61367 | 61408 | 41 | -19 | 103 | 120 | inside | **19 frames missing** |
| 61408 | 61468 | 60 | 0 | 120 | 113 | inside |  |
| 61468 | 61529 | 61 | +1 | 113 | 123 | context | jitter (within read error) |

### Break 3: removed, frames 171397 – 171498 (00:47:36.617 – 00:47:38.300)

| from | to | spacing | deviation | before | after | where | note |
|---|---|---|---|---|---|---|---|
| 171319 | 171379 | 60 | 0 | 246 | 272 | context |  |
| 171379 | 171439 | 60 | 0 | 272 | 144 | inside |  |
| 171439 | 171483 | 44 | -16 | 144 | 231 | inside | **16 frames missing** |
| 171483 | 171512 | 29 | +29 | 231 | 221 | inside | **29 frames added** |
| 171512 | 171572 | 60 | 0 | 221 | 159 | context |  |

## Ranked by |ΔFPS|

| rank | kind | time | frame | shift | before | after | \|d\| | note |
|---|---|---|---|---|---|---|---|---|
| 1 | Value | 02:35:59.133 | 561548 |  | 1326 | 146 | 1180 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 2 | Value | 02:35:53.117 | 561187 |  | 578 | 1297 | 719 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 3 | Value | 00:33:23.333 | 120200 |  | 809 | 299 | 510 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 4 | Value | 00:33:18.333 | 119900 |  | 708 | 205 | 503 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 5 | Value | 01:06:39.517 | 239971 |  | 291 | 783 | 492 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 6 | Value | 00:33:08.333 | 119300 |  | 697 | 240 | 457 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 7 | Value | 01:07:20.517 | 242431 |  | 790 | 344 | 446 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 8 | Value | 01:07:29.517 | 242971 |  | 304 | 729 | 425 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 9 | Value | 01:07:57.517 | 244651 |  | 704 | 280 | 424 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 10 | Value | 00:32:56.333 | 118580 |  | 639 | 218 | 421 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 11 | Value | 00:33:04.333 | 119060 |  | 201 | 621 | 420 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 12 | Value | 01:07:52.517 | 244351 |  | 323 | 732 | 409 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 13 | Value | 00:33:25.333 | 120320 |  | 209 | 612 | 403 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 14 | Value | 01:07:07.517 | 241651 |  | 695 | 301 | 394 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 15 | Value | 02:35:52.117 | 561127 |  | 184 | 578 | 394 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 16 | Value | 01:12:31.517 | 261091 |  | 527 | 138 | 389 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 17 | Value | 01:06:51.533 | 240692 |  | 214 | 598 | 384 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 18 | Value | 02:25:18.567 | 523114 |  | 3 | 382 | 379 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 19 | Value | 00:33:20.333 | 120020 |  | 217 | 593 | 376 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 20 | Value | 00:33:15.333 | 119720 |  | 218 | 589 | 371 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 21 | Value | 01:07:13.533 | 242012 |  | 284 | 655 | 371 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 22 | Value | 02:30:46.567 | 542794 |  | 8 | 370 | 362 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 23 | Value | 02:08:19.300 | 461958 |  | 130 | 489 | 359 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 24 | Value | 01:07:30.533 | 243032 |  | 729 | 374 | 355 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 25 | Value | 01:06:41.517 | 240091 |  | 753 | 399 | 354 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 26 | Value | 01:06:55.533 | 240932 |  | 222 | 572 | 350 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 27 | Value | 01:11:54.533 | 258872 |  | 476 | 128 | 348 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 28 | Value | 00:57:56.533 | 208592 |  | 566 | 219 | 347 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 29 | Value | 01:07:34.517 | 243271 |  | 262 | 597 | 335 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 30 | Value | 00:33:31.333 | 120680 |  | 371 | 704 | 333 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 31 | Value | 02:08:47.483 | 463649 |  | 119 | 450 | 331 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 32 | Value | 02:08:11.300 | 461478 |  | 133 | 463 | 330 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 33 | Value | 01:06:52.533 | 240752 |  | 598 | 269 | 329 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 34 | Value | 01:12:40.517 | 261631 |  | 526 | 203 | 323 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 35 | Value | 01:07:53.533 | 244412 |  | 732 | 411 | 321 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 36 | Value | 00:57:46.533 | 207992 |  | 515 | 197 | 318 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 37 | Value | 00:19:58.450 | 71907 |  | 471 | 155 | 316 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 38 | Value | 01:07:06.517 | 241591 |  | 379 | 695 | 316 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 39 | Value | 01:07:11.533 | 241892 |  | 547 | 233 | 314 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 40 | Drift | 01:07:49.533 | 244172 | +1 | 523 | 209 | 314 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 41 | Value | 01:07:56.517 | 244591 |  | 390 | 704 | 314 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 42 | Value | 01:11:59.533 | 259172 |  | 469 | 160 | 309 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 43 | Value | 00:32:18.333 | 116300 |  | 446 | 145 | 301 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 44 | Drift | 01:12:26.533 | 260792 | +1 | 453 | 153 | 300 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 45 | Value | 00:33:13.333 | 119600 |  | 732 | 433 | 299 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 46 | Drift | 01:06:58.517 | 241111 | -1 | 533 | 234 | 299 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 47 | Value | 01:12:33.533 | 261212 |  | 137 | 436 | 299 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 48 | Value | 00:57:54.533 | 208472 |  | 220 | 518 | 298 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 49 | Value | 00:32:58.333 | 118700 |  | 325 | 620 | 295 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 50 | Value | 02:30:46.150 | 542769 |  | 301 | 8 | 293 | POSSIBLE PARTIAL READ (one value is a prefix/suffix of the other); largest value swings (top 1 %): no phase change, listed for cross-checking |
| 51 | Value | 01:11:00.533 | 255632 |  | 461 | 169 | 292 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 52 | Value | 00:32:36.333 | 117380 |  | 568 | 279 | 289 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 53 | Value | 02:14:13.267 | 483196 |  | 528 | 239 | 289 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 54 | Value | 00:32:32.333 | 117140 |  | 176 | 462 | 286 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 55 | Value | 00:33:33.333 | 120800 |  | 756 | 472 | 284 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 56 | Drift | 01:12:23.517 | 260611 | -1 | 160 | 442 | 282 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 57 | Value | 00:33:34.333 | 120860 |  | 472 | 191 | 281 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 58 | Value | 01:07:09.517 | 241771 |  | 237 | 517 | 280 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 59 | Value | 00:33:36.333 | 120980 |  | 385 | 662 | 277 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 60 | Value | 00:33:39.333 | 121160 |  | 447 | 172 | 275 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 61 | Value | 00:33:00.333 | 118820 |  | 655 | 381 | 274 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 62 | Value | 01:11:44.517 | 258271 |  | 466 | 192 | 274 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 63 | Value | 01:07:25.517 | 242731 |  | 354 | 626 | 272 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 64 | Value | 00:32:53.333 | 118400 |  | 484 | 213 | 271 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 65 | Value | 00:33:40.333 | 121220 |  | 172 | 443 | 271 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 66 | Value | 00:22:18.450 | 80307 |  | 183 | 451 | 268 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 67 | Value | 00:32:50.333 | 118220 |  | 213 | 481 | 268 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 68 | Value | 01:06:44.517 | 240271 |  | 395 | 663 | 268 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 69 | Value | 02:09:01.300 | 464478 |  | 390 | 122 | 268 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 70 | Value | 02:20:17.217 | 505033 |  | 445 | 178 | 267 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 71 | Value | 00:16:24.783 | 59087 |  | 374 | 108 | 266 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 72 | Value | 02:09:00.300 | 464418 |  | 124 | 390 | 266 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 73 | Value | 00:32:55.333 | 118520 |  | 374 | 639 | 265 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 74 | Value | 00:42:12.333 | 151940 |  | 202 | 467 | 265 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 75 | Value | 01:11:31.517 | 257491 |  | 496 | 231 | 265 | largest value swings (top 1 %): no phase change, listed for cross-checking |
| 76 | Drift | 01:09:26.533 | 249992 | +1 | 400 | 139 | 261 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 77 | Drift | 01:26:13.500 | 310410 | +1 | 469 | 239 | 230 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 78 | Drift | 01:11:29.517 | 257371 | -1 | 197 | 409 | 212 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 79 | Drift | 01:02:32.517 | 225151 | -1 | 180 | 391 | 211 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 80 | Drift | 01:11:39.533 | 257972 | +1 | 419 | 217 | 202 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 81 | Drift | 02:17:10.233 | 493814 | -1 | 150 | 348 | 198 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 82 | Drift | 01:11:56.517 | 258991 | -1 | 117 | 314 | 197 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 83 | Drift | 01:07:33.517 | 243211 | -1 | 457 | 262 | 195 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 84 | Drift | 01:12:28.517 | 260911 | -1 | 155 | 349 | 194 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 85 | Drift | 01:12:36.533 | 261392 | +1 | 336 | 142 | 194 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 86 | Drift | 00:23:13.450 | 83607 | -1 | 364 | 171 | 193 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 87 | Drift | 02:21:37.233 | 509834 | +1 | 307 | 117 | 190 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 88 | Drift | 01:12:21.533 | 260492 | +1 | 322 | 137 | 185 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 89 | Drift | 01:07:27.533 | 242852 | +1 | 563 | 383 | 180 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 90 | Drift | 02:16:51.233 | 492674 | -1 | 123 | 302 | 179 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 91 | Drift | 00:24:07.450 | 86847 | -1 | 167 | 342 | 175 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 92 | Drift | 01:10:36.517 | 254191 | -1 | 162 | 335 | 173 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 93 | Drift | 00:21:13.467 | 76408 | +1 | 348 | 177 | 171 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 94 | Drift | 01:12:38.517 | 261511 | -1 | 240 | 410 | 170 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 95 | Drift | 00:20:21.467 | 73288 | +1 | 384 | 215 | 169 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 96 | Drift | 00:18:51.450 | 67887 | -1 | 125 | 289 | 164 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 97 | Drift | 00:25:40.450 | 92427 | -1 | 330 | 171 | 159 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 98 | Drift | 02:17:12.250 | 493935 | +1 | 285 | 134 | 151 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 99 | Drift | 01:12:11.533 | 259892 | +1 | 279 | 131 | 148 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 100 | Drift | 02:20:14.217 | 504853 | -1 | 249 | 397 | 148 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 101 | Drift | 02:12:16.267 | 476176 | -1 | 245 | 100 | 145 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 102 | Drift | 01:02:53.533 | 226412 | +1 | 318 | 175 | 143 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 103 | Drift | 00:29:33.400 | 106404 | -1 | 157 | 298 | 141 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 104 | Drift | 02:20:55.233 | 507314 | +1 | 306 | 165 | 141 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 105 | Drift | 01:06:25.533 | 239132 | +1 | 218 | 356 | 138 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 106 | Drift | 00:26:15.467 | 94528 | +1 | 296 | 159 | 137 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 107 | Drift | 02:06:32.300 | 455538 | -2 | 126 | 263 | 137 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 108 | Drift | 00:20:23.450 | 73407 | -1 | 122 | 256 | 134 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 109 | Drift | 00:21:03.450 | 75807 | -1 | 134 | 264 | 130 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 110 | Drift | 01:07:51.517 | 244291 | -1 | 193 | 323 | 130 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 111 | Drift | 00:12:44.850 | 45891 | -1 | 120 | 249 | 129 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 112 | Drift | 02:22:01.250 | 511275 | +2 | 105 | 234 | 129 | phase moved +2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 113 | Drift | 00:24:12.467 | 87148 | +1 | 423 | 295 | 128 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 114 | Drift | 01:02:50.517 | 226231 | -1 | 172 | 297 | 125 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 115 | Drift | 01:07:42.533 | 243752 | +1 | 551 | 426 | 125 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 116 | Drift | 01:16:49.517 | 276571 | +1 | 233 | 109 | 124 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 117 | Drift | 00:19:04.467 | 68668 | +1 | 392 | 269 | 123 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 118 | Drift | 01:11:41.517 | 258091 | -1 | 231 | 354 | 123 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 119 | Drift | 02:21:33.217 | 509593 | -1 | 106 | 228 | 122 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 120 | Drift | 01:48:46.383 | 391583 | +1 | 293 | 172 | 121 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 121 | Drift | 00:11:13.917 | 40435 | +1 | 241 | 121 | 120 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 122 | Drift | 01:11:32.533 | 257552 | +1 | 231 | 350 | 119 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 123 | Drift | 01:27:42.483 | 315749 | -1 | 297 | 179 | 118 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 124 | Drift | 00:18:59.450 | 68367 | -1 | 119 | 236 | 117 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 125 | Drift | 00:20:51.467 | 75088 | +1 | 271 | 163 | 108 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 126 | Drift | 01:04:05.517 | 230731 | -1 | 148 | 254 | 106 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 127 | Drift | 00:23:15.467 | 83728 | +1 | 231 | 334 | 103 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 128 | Drift | 00:23:31.450 | 84687 | -1 | 312 | 209 | 103 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 129 | Drift | 00:29:23.400 | 105804 | -1 | 129 | 230 | 101 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 130 | Drift | 01:05:09.517 | 234571 | -1 | 148 | 247 | 99 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 131 | Drift | 01:07:58.533 | 244712 | +1 | 280 | 379 | 99 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 132 | Drift | 01:16:31.517 | 275491 | +1 | 212 | 114 | 98 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 133 | Drift | 00:20:04.450 | 72267 | -1 | 189 | 286 | 97 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 134 | Drift | 00:22:20.467 | 80428 | +1 | 491 | 395 | 96 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 135 | Drift | 01:54:19.350 | 411561 | +1 | 377 | 282 | 95 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 136 | Drift | 00:26:41.467 | 96088 | +1 | 157 | 251 | 94 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 137 | Drift | 01:11:53.533 | 258812 | +1 | 568 | 476 | 92 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 138 | Drift | 01:51:27.367 | 401242 | -1 | 251 | 160 | 91 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 139 | Drift | 02:09:02.283 | 464537 | -1 | 122 | 213 | 91 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 140 | Drift | 02:17:07.250 | 493635 | +1 | 326 | 235 | 91 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 141 | Drift | 00:48:35.550 | 174933 | +1 | 218 | 128 | 90 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 142 | Drift | 00:29:12.417 | 105145 | +1 | 239 | 150 | 89 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 143 | Drift | 00:47:26.333 | 170780 | +1 | 130 | 219 | 89 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 144 | Drift | 01:12:43.533 | 261812 | +1 | 278 | 189 | 89 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 145 | Drift | 00:20:53.450 | 75207 | -1 | 127 | 214 | 87 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 146 | Drift | 00:22:48.450 | 82107 | -1 | 247 | 161 | 86 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 147 | Drift | 01:15:13.500 | 270810 | -1 | 113 | 199 | 86 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 148 | Drift | 00:23:43.450 | 85407 | -1 | 297 | 212 | 85 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 149 | Drift | 01:25:02.500 | 306150 | +1 | 257 | 172 | 85 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 150 | Drift | 00:26:05.467 | 93928 | +1 | 210 | 126 | 84 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 151 | Drift | 02:20:19.250 | 505155 | +2 | 279 | 196 | 83 | phase moved +2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 152 | Drift | 00:20:00.467 | 72028 | +1 | 372 | 291 | 81 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 153 | Drift | 01:27:25.483 | 314729 | -1 | 259 | 180 | 79 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 154 | Drift | 01:29:11.483 | 321089 | -1 | 161 | 240 | 79 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 155 | Drift | 00:20:56.467 | 75388 | +1 | 307 | 230 | 77 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 156 | Drift | 01:08:07.517 | 245251 | -1 | 212 | 289 | 77 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 157 | Drift | 00:26:43.450 | 96207 | -1 | 148 | 224 | 76 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 158 | Drift | 01:07:47.517 | 244051 | -1 | 248 | 324 | 76 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 159 | Drift | 01:11:50.517 | 258631 | -1 | 215 | 291 | 76 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 160 | Drift | 01:24:36.483 | 304589 | -1 | 187 | 263 | 76 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 161 | Drift | 02:21:31.233 | 509474 | +1 | 185 | 110 | 75 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 162 | Drift | 01:06:27.517 | 239251 | -1 | 114 | 188 | 74 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 163 | Drift | 00:24:17.450 | 87447 | -1 | 203 | 276 | 73 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 164 | Drift | 01:25:05.483 | 306329 | -1 | 173 | 246 | 73 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 165 | Drift | 02:22:03.217 | 511393 | -2 | 109 | 182 | 73 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 166 | Drift | 00:29:09.400 | 104964 | -1 | 140 | 211 | 71 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 167 | Drift | 00:52:33.533 | 189212 | -1 | 134 | 204 | 70 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 168 | Drift | 01:51:19.367 | 400762 | -1 | 240 | 170 | 70 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 169 | Drift | 01:27:23.500 | 314610 | +1 | 288 | 220 | 68 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 170 | Drift | 00:46:09.317 | 166159 | -1 | 188 | 124 | 64 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 171 | Drift | 01:04:09.533 | 230972 | +1 | 350 | 287 | 63 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 172 | Drift | 01:24:32.500 | 304350 | +1 | 247 | 187 | 60 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 173 | Drift | 01:28:00.483 | 316829 | -1 | 180 | 240 | 60 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 174 | Drift | 00:24:57.467 | 89848 | +1 | 338 | 279 | 59 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 175 | Drift | 01:53:39.350 | 409161 | -1 | 173 | 231 | 58 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 176 | Drift | 01:20:06.500 | 288390 | -1 | 160 | 103 | 57 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 177 | Drift | 01:09:24.517 | 249871 | -1 | 109 | 165 | 56 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 178 | Drift | 01:25:24.500 | 307470 | +1 | 321 | 266 | 55 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 179 | Drift | 02:22:27.217 | 512833 | -1 | 91 | 146 | 55 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 180 | Drift | 01:12:57.533 | 262652 | +1 | 189 | 243 | 54 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 181 | Drift | 01:26:39.500 | 311970 | +1 | 185 | 239 | 54 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 182 | Drift | 00:27:40.467 | 99628 | +1 | 299 | 246 | 53 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 183 | Drift | 00:28:31.417 | 102685 | -1 | 132 | 183 | 51 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 184 | Drift | 02:21:12.217 | 508333 | -1 | 170 | 119 | 51 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 185 | Drift | 00:30:51.367 | 111082 | -1 | 184 | 234 | 50 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 186 | Drift | 01:58:28.333 | 426500 | -1 | 161 | 211 | 50 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 187 | Drift | 00:20:42.467 | 74548 | +1 | 232 | 281 | 49 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 188 | Drift | 01:08:31.533 | 246692 | +1 | 257 | 208 | 49 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 189 | Drift | 00:43:18.333 | 155900 | +1 | 248 | 296 | 48 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 190 | Drift | 00:44:38.333 | 160700 | +1 | 154 | 108 | 46 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 191 | Drift | 01:14:14.500 | 267270 | -2 | 104 | 150 | 46 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 192 | Drift | 00:55:54.533 | 201272 | -1 | 119 | 164 | 45 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 193 | Drift | 00:18:55.467 | 68128 | +1 | 354 | 310 | 44 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 194 | Drift | 00:25:26.467 | 91588 | +1 | 185 | 229 | 44 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 195 | Drift | 01:06:50.533 | 240632 | +1 | 258 | 214 | 44 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 196 | Drift | 01:22:32.483 | 297149 | -1 | 251 | 207 | 44 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 197 | Drift | 01:48:25.383 | 390323 | +1 | 311 | 268 | 43 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 198 | Drift | 02:06:30.333 | 455420 | +2 | 232 | 189 | 43 | phase moved +2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 199 | Drift | 01:12:46.517 | 261991 | -1 | 135 | 177 | 42 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 200 | Drift | 01:22:30.500 | 297030 | +1 | 244 | 202 | 42 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 201 | Drift | 01:18:09.517 | 281371 | +1 | 161 | 120 | 41 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 202 | Drift | 01:12:04.517 | 259471 | -1 | 363 | 323 | 40 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 203 | Drift | 00:25:24.450 | 91467 | -1 | 156 | 195 | 39 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 204 | Drift | 00:28:51.433 | 103886 | +1 | 173 | 134 | 39 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 205 | Drift | 02:09:23.283 | 465797 | -1 | 160 | 199 | 39 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 206 | Drift | 01:02:47.533 | 226052 | +1 | 305 | 343 | 38 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 207 | Drift | 01:51:45.367 | 402322 | -1 | 244 | 206 | 38 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 208 | Drift | 00:13:12.867 | 47572 | +1 | 315 | 352 | 37 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 209 | Drift | 01:06:21.517 | 238891 | -1 | 247 | 210 | 37 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 210 | Drift | 01:12:01.533 | 259292 | +1 | 244 | 207 | 37 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 211 | Drift | 00:16:23.783 | 59027 | +1 | 338 | 374 | 36 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 212 | Drift | 01:08:39.533 | 247172 | +1 | 234 | 198 | 36 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 213 | Drift | 01:26:16.483 | 310589 | -1 | 230 | 194 | 36 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 214 | Drift | 01:28:15.500 | 317730 | +1 | 199 | 163 | 36 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 215 | Drift | 00:25:43.467 | 92608 | +1 | 230 | 195 | 35 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 216 | Drift | 01:01:28.517 | 221311 | -1 | 217 | 182 | 35 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 217 | Drift | 00:17:56.467 | 64588 | -1 | 122 | 155 | 33 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 218 | Drift | 00:45:24.317 | 163459 | -1 | 140 | 173 | 33 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 219 | Drift | 01:27:58.500 | 316710 | +1 | 171 | 204 | 33 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 220 | Drift | 01:48:51.367 | 391882 | -1 | 186 | 153 | 33 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 221 | Drift | 02:21:19.233 | 508754 | +1 | 286 | 253 | 33 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 222 | Drift | 00:21:52.467 | 78748 | +1 | 271 | 303 | 32 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 223 | Drift | 01:18:19.500 | 281970 | -1 | 120 | 152 | 32 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 224 | Drift | 01:21:53.483 | 294809 | -1 | 121 | 153 | 32 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 225 | Drift | 01:28:24.483 | 318269 | -1 | 172 | 204 | 32 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 226 | Drift | 02:09:32.300 | 466338 | +1 | 182 | 214 | 32 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 227 | Drift | 00:11:10.900 | 40254 | -1 | 96 | 127 | 31 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 228 | Drift | 00:24:29.467 | 88168 | +1 | 196 | 165 | 31 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 229 | Drift | 01:04:13.533 | 231212 | +1 | 147 | 178 | 31 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 230 | Drift | 01:57:42.333 | 423740 | -1 | 255 | 286 | 31 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 231 | Drift | 00:26:22.467 | 94948 | +1 | 210 | 180 | 30 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 232 | Drift | 00:47:16.317 | 170179 | -1 | 158 | 128 | 30 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 233 | Drift | 00:12:57.867 | 46672 | +1 | 110 | 139 | 29 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 234 | Drift | 01:05:11.533 | 234692 | +1 | 436 | 465 | 29 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 235 | Drift | 02:20:20.233 | 505214 | -1 | 196 | 167 | 29 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 236 | Drift | 00:49:04.550 | 176673 | +1 | 142 | 170 | 28 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 237 | Drift | 02:21:50.233 | 510614 | +1 | 141 | 113 | 28 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 238 | Drift | 01:08:33.517 | 246811 | -1 | 166 | 193 | 27 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 239 | Drift | 01:29:29.500 | 322170 | +1 | 188 | 215 | 27 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 240 | Drift | 01:48:27.367 | 390442 | -1 | 247 | 220 | 27 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 241 | Drift | 01:58:30.350 | 426621 | +1 | 215 | 242 | 27 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 242 | Drift | 02:05:19.300 | 451158 | -1 | 187 | 214 | 27 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 243 | Drift | 01:22:53.500 | 298410 | +1 | 191 | 217 | 26 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 244 | Drift | 01:24:30.483 | 304229 | -1 | 255 | 281 | 26 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 245 | Drift | 00:26:02.450 | 93747 | -1 | 175 | 200 | 25 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 246 | Drift | 00:28:24.433 | 102266 | -2 | 144 | 169 | 25 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 247 | Drift | 00:23:29.467 | 84568 | +1 | 424 | 400 | 24 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 248 | Drift | 00:39:59.350 | 143961 | +1 | 120 | 96 | 24 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 249 | Drift | 01:26:45.483 | 312329 | -1 | 176 | 200 | 24 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 250 | Drift | 01:37:58.400 | 352704 | -2 | 217 | 193 | 24 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 251 | Drift | 00:29:27.417 | 106045 | +1 | 200 | 223 | 23 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 252 | Drift | 01:03:40.517 | 229231 | -1 | 335 | 358 | 23 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 253 | Drift | 01:11:34.517 | 257671 | -1 | 199 | 176 | 23 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 254 | Drift | 01:23:40.483 | 301229 | -1 | 221 | 198 | 23 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 255 | Drift | 01:26:28.500 | 311310 | +1 | 151 | 174 | 23 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 256 | Drift | 01:48:19.367 | 389962 | -2 | 264 | 241 | 23 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 257 | Drift | 01:50:40.383 | 398423 | +1 | 209 | 186 | 23 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 258 | Drift | 02:22:11.233 | 511874 | +1 | 135 | 112 | 23 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 259 | Drift | 00:26:47.467 | 96448 | +1 | 157 | 179 | 22 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 260 | Drift | 00:26:53.450 | 96807 | -1 | 179 | 157 | 22 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 261 | Drift | 00:45:02.317 | 162139 | -1 | 119 | 141 | 22 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 262 | Drift | 01:26:49.500 | 312570 | +1 | 204 | 226 | 22 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 263 | Jump | 00:12:21.850 | 44511 | -4 | 92 | 113 | 21 | phase moved -4 frames and stayed: not continuous here |
| 264 | Drift | 00:26:18.450 | 94707 | -1 | 187 | 208 | 21 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 265 | Drift | 00:26:55.467 | 96928 | +1 | 199 | 220 | 21 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 266 | Drift | 00:51:23.550 | 185013 | +1 | 136 | 115 | 21 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 267 | Drift | 01:28:34.500 | 318870 | +1 | 167 | 188 | 21 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 268 | Drift | 01:49:37.383 | 394643 | +1 | 187 | 208 | 21 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 269 | Drift | 00:26:33.467 | 95608 | +1 | 173 | 153 | 20 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 270 | Drift | 00:26:35.450 | 95727 | -1 | 144 | 164 | 20 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 271 | Drift | 00:30:53.383 | 111203 | +1 | 195 | 175 | 20 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 272 | Drift | 00:52:00.533 | 187232 | -1 | 138 | 158 | 20 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 273 | Drift | 01:02:02.517 | 223351 | -1 | 191 | 211 | 20 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 274 | Drift | 01:06:12.517 | 238351 | -1 | 195 | 215 | 20 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 275 | Drift | 01:19:49.517 | 287371 | +1 | 118 | 98 | 20 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 276 | Drift | 00:45:14.317 | 162859 | -1 | 126 | 145 | 19 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 277 | Drift | 00:52:21.550 | 188493 | +1 | 142 | 123 | 19 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 278 | Drift | 00:57:01.550 | 205293 | +1 | 129 | 148 | 19 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 279 | Drift | 01:23:35.500 | 300930 | +1 | 206 | 187 | 19 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 280 | Drift | 01:51:43.383 | 402203 | +1 | 217 | 198 | 19 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 281 | Drift | 02:09:35.283 | 466517 | -1 | 186 | 205 | 19 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 282 | Drift | 01:01:44.517 | 222271 | -1 | 170 | 152 | 18 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 283 | Drift | 01:10:59.533 | 255572 | +1 | 443 | 461 | 18 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 284 | Drift | 01:24:55.483 | 305729 | -1 | 180 | 198 | 18 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 285 | Drift | 01:37:10.433 | 349826 | +1 | 271 | 253 | 18 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 286 | Drift | 00:12:29.850 | 44991 | -1 | 155 | 138 | 17 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 287 | Drift | 00:14:56.800 | 53808 | -1 | 136 | 119 | 17 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 288 | Jump | 00:17:03.467 | 61408 | -19 | 103 | 120 | 17 | phase moved -19 frames and stayed: not continuous here |
| 289 | Drift | 00:26:27.450 | 95247 | -1 | 158 | 175 | 17 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 290 | Drift | 00:49:20.550 | 177633 | +1 | 141 | 124 | 17 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 291 | Drift | 01:15:09.517 | 270571 | +1 | 116 | 133 | 17 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 292 | Drift | 01:25:45.500 | 308730 | +1 | 197 | 180 | 17 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 293 | Drift | 01:27:51.483 | 316289 | -1 | 273 | 290 | 17 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 294 | Drift | 01:28:48.500 | 319710 | +1 | 186 | 169 | 17 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 295 | Drift | 01:48:37.367 | 391042 | -1 | 172 | 189 | 17 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 296 | Drift | 00:14:32.817 | 52369 | +1 | 110 | 126 | 16 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 297 | Drift | 00:15:01.817 | 54109 | +1 | 119 | 103 | 16 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 298 | Drift | 00:25:50.450 | 93027 | -1 | 138 | 122 | 16 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 299 | Drift | 00:34:46.350 | 125181 | +1 | 113 | 97 | 16 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 300 | Drift | 00:51:27.533 | 185252 | -1 | 112 | 128 | 16 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 301 | Drift | 01:01:30.533 | 221432 | +1 | 162 | 178 | 16 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 302 | Drift | 01:16:51.500 | 276690 | -1 | 110 | 126 | 16 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 303 | Drift | 01:23:58.483 | 302309 | -1 | 170 | 186 | 16 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 304 | Drift | 01:51:14.383 | 400463 | +1 | 161 | 177 | 16 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 305 | Drift | 00:24:24.467 | 87868 | +1 | 176 | 161 | 15 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 306 | Drift | 00:24:55.450 | 89727 | -1 | 123 | 138 | 15 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 307 | Drift | 00:36:25.350 | 131121 | +1 | 111 | 96 | 15 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 308 | Drift | 01:28:28.500 | 318510 | +1 | 185 | 170 | 15 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 309 | Drift | 01:50:45.367 | 398722 | -1 | 166 | 181 | 15 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 310 | Drift | 02:04:55.317 | 449719 | -1 | 196 | 181 | 15 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 311 | Drift | 02:09:37.300 | 466638 | +1 | 203 | 188 | 15 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 312 | Drift | 00:23:38.467 | 85108 | +1 | 201 | 187 | 14 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 313 | Drift | 00:53:02.533 | 190952 | -1 | 125 | 139 | 14 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 314 | Drift | 01:02:07.533 | 223652 | +1 | 216 | 202 | 14 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 315 | Drift | 01:03:45.533 | 229532 | +1 | 264 | 250 | 14 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 316 | Drift | 01:11:20.533 | 256832 | +1 | 208 | 194 | 14 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 317 | Drift | 01:15:15.517 | 270931 | +1 | 109 | 123 | 14 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 318 | Drift | 01:28:10.483 | 317429 | -1 | 189 | 175 | 14 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 319 | Drift | 01:29:05.500 | 320730 | +1 | 192 | 178 | 14 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 320 | Drift | 01:37:44.417 | 351865 | -1 | 211 | 197 | 14 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 321 | Drift | 01:49:43.367 | 395002 | -1 | 204 | 190 | 14 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 322 | Drift | 00:12:42.867 | 45772 | +1 | 124 | 111 | 13 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 323 | Drift | 00:15:08.783 | 54527 | -1 | 119 | 106 | 13 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 324 | Drift | 00:17:44.483 | 63869 | +1 | 111 | 98 | 13 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 325 | Drift | 00:18:13.467 | 65608 | -1 | 122 | 109 | 13 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 326 | Drift | 00:22:17.450 | 80247 | -1 | 170 | 183 | 13 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 327 | Drift | 00:23:23.450 | 84207 | -1 | 208 | 195 | 13 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 328 | Drift | 00:44:36.317 | 160579 | -1 | 107 | 120 | 13 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 329 | Drift | 00:44:46.333 | 161180 | +1 | 157 | 144 | 13 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 330 | Drift | 00:45:37.333 | 164240 | +1 | 216 | 203 | 13 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 331 | Drift | 01:10:08.517 | 252511 | -1 | 165 | 178 | 13 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 332 | Drift | 01:10:13.533 | 252812 | +1 | 180 | 167 | 13 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 333 | Drift | 01:12:17.517 | 260251 | -1 | 132 | 145 | 13 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 334 | Drift | 01:22:15.500 | 296130 | +1 | 211 | 198 | 13 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 335 | Drift | 01:48:31.383 | 390683 | +1 | 160 | 173 | 13 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 336 | Drift | 00:17:14.467 | 62068 | -1 | 112 | 100 | 12 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 337 | Drift | 00:27:35.450 | 99327 | -1 | 158 | 146 | 12 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 338 | Drift | 00:30:46.367 | 110782 | -1 | 99 | 111 | 12 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 339 | Drift | 00:40:41.333 | 146480 | -1 | 88 | 100 | 12 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 340 | Drift | 00:45:19.317 | 163159 | -1 | 137 | 125 | 12 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 341 | Drift | 00:46:07.333 | 166040 | +1 | 227 | 215 | 12 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 342 | Drift | 00:46:15.333 | 166520 | +1 | 129 | 117 | 12 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 343 | Drift | 00:48:38.533 | 175112 | -1 | 123 | 111 | 12 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 344 | Drift | 00:48:53.550 | 176013 | +1 | 144 | 132 | 12 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 345 | Drift | 01:28:30.483 | 318629 | -1 | 178 | 166 | 12 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 346 | Drift | 01:37:04.417 | 349465 | -1 | 154 | 166 | 12 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 347 | Drift | 01:37:34.433 | 351266 | +1 | 211 | 223 | 12 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 348 | Drift | 00:13:14.833 | 47690 | -2 | 133 | 144 | 11 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 349 | Drift | 00:17:11.483 | 61889 | +1 | 106 | 117 | 11 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 350 | Drift | 00:43:39.317 | 157159 | -1 | 108 | 97 | 11 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 351 | Drift | 00:45:04.333 | 162260 | +1 | 246 | 235 | 11 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 352 | Drift | 00:50:34.533 | 182072 | -1 | 124 | 135 | 11 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 353 | Drift | 00:52:23.533 | 188612 | -1 | 132 | 143 | 11 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 354 | Drift | 00:52:30.550 | 189033 | +1 | 126 | 115 | 11 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 355 | Drift | 01:02:30.533 | 225032 | +1 | 200 | 189 | 11 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 356 | Drift | 01:15:21.500 | 271290 | -1 | 113 | 124 | 11 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 357 | Drift | 01:15:50.500 | 273030 | -1 | 106 | 117 | 11 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 358 | Drift | 01:17:57.517 | 280651 | +1 | 123 | 112 | 11 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 359 | Drift | 01:18:17.517 | 281851 | +1 | 106 | 117 | 11 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 360 | Drift | 01:21:55.500 | 294930 | +1 | 177 | 188 | 11 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 361 | Drift | 01:25:15.483 | 306929 | -1 | 215 | 226 | 11 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 362 | Drift | 01:25:41.500 | 308490 | +1 | 188 | 177 | 11 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 363 | Drift | 01:26:57.483 | 313049 | -1 | 153 | 142 | 11 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 364 | Drift | 01:37:46.433 | 351986 | +1 | 182 | 171 | 11 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 365 | Drift | 02:23:14.200 | 515652 | -1 | 89 | 100 | 11 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 366 | Drift | 00:15:04.800 | 54288 | -1 | 110 | 120 | 10 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 367 | Drift | 00:24:05.467 | 86728 | +1 | 354 | 344 | 10 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 368 | Drift | 00:26:12.450 | 94347 | -1 | 121 | 131 | 10 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 369 | Drift | 00:34:53.333 | 125600 | -1 | 87 | 97 | 10 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 370 | Drift | 00:44:56.317 | 161779 | -1 | 117 | 107 | 10 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 371 | Drift | 00:45:16.333 | 162980 | +1 | 143 | 133 | 10 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 372 | Drift | 00:46:39.317 | 167959 | -1 | 121 | 131 | 10 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 373 | Drift | 00:46:41.333 | 168080 | +1 | 133 | 123 | 10 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 374 | Jump | 00:47:38.533 | 171512 | +13 | 231 | 221 | 10 | phase moved +13 frames and stayed: not continuous here |
| 375 | Drift | 00:50:31.550 | 181893 | +1 | 136 | 126 | 10 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 376 | Drift | 01:18:50.500 | 283830 | -1 | 99 | 109 | 10 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 377 | Drift | 01:19:32.517 | 286351 | +1 | 112 | 102 | 10 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 378 | Drift | 01:27:46.500 | 315990 | +1 | 202 | 192 | 10 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 379 | Drift | 01:57:44.350 | 423861 | +1 | 289 | 279 | 10 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 380 | Drift | 01:59:26.317 | 429979 | -2 | 218 | 208 | 10 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 381 | Drift | 02:16:54.250 | 492855 | +1 | 365 | 355 | 10 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 382 | Drift | 00:16:21.767 | 58906 | -1 | 109 | 118 | 9 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 383 | Drift | 00:17:30.483 | 63029 | +1 | 112 | 121 | 9 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 384 | Drift | 00:21:25.450 | 77127 | -1 | 126 | 135 | 9 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 385 | Drift | 00:25:20.467 | 91228 | +1 | 144 | 153 | 9 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 386 | Drift | 00:44:27.317 | 160039 | -1 | 96 | 105 | 9 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 387 | Drift | 00:48:31.533 | 174692 | -1 | 134 | 143 | 9 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 388 | Drift | 01:06:14.533 | 238472 | +1 | 197 | 206 | 9 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 389 | Drift | 01:24:39.500 | 304770 | +1 | 175 | 184 | 9 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 390 | Drift | 01:37:21.417 | 350485 | -1 | 177 | 168 | 9 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 391 | Drift | 02:21:28.217 | 509293 | -1 | 95 | 104 | 9 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 392 | Drift | 02:22:22.217 | 512533 | -1 | 96 | 87 | 9 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 393 | Drift | 02:23:44.200 | 517452 | +1 | 104 | 113 | 9 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 394 | Drift | 00:12:59.850 | 46791 | -1 | 109 | 117 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 395 | Drift | 00:13:59.817 | 50389 | +1 | 108 | 116 | 8 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 396 | Drift | 00:14:03.800 | 50628 | -1 | 128 | 120 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 397 | Drift | 00:17:39.483 | 63569 | +1 | 109 | 117 | 8 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 398 | Drift | 00:24:27.450 | 88047 | -1 | 158 | 166 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 399 | Drift | 00:29:05.417 | 104725 | -1 | 123 | 131 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 400 | Drift | 00:29:35.417 | 106525 | +1 | 138 | 130 | 8 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 401 | Drift | 00:40:03.333 | 144200 | -1 | 95 | 103 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 402 | Drift | 00:49:15.550 | 177333 | +1 | 137 | 129 | 8 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 403 | Drift | 00:52:56.550 | 190593 | +1 | 154 | 162 | 8 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 404 | Drift | 01:02:28.517 | 224911 | -1 | 194 | 186 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 405 | Drift | 01:15:52.517 | 273151 | +1 | 108 | 116 | 8 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 406 | Drift | 01:18:12.500 | 281550 | -1 | 127 | 119 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 407 | Drift | 01:25:07.500 | 306450 | +1 | 312 | 320 | 8 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 408 | Drift | 01:25:55.483 | 309329 | -1 | 203 | 211 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 409 | Drift | 01:27:33.500 | 315210 | +1 | 169 | 177 | 8 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 410 | Drift | 01:29:01.483 | 320489 | -1 | 186 | 178 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 411 | Drift | 01:37:25.433 | 350726 | +1 | 187 | 195 | 8 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 412 | Drift | 01:51:00.367 | 399622 | -1 | 166 | 174 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 413 | Drift | 02:16:48.250 | 492495 | -1 | 148 | 140 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 414 | Drift | 02:21:40.217 | 510013 | -1 | 94 | 102 | 8 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 415 | Drift | 00:25:55.467 | 93328 | +1 | 168 | 175 | 7 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 416 | Drift | 00:30:33.367 | 110002 | -2 | 106 | 113 | 7 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 417 | Drift | 00:31:01.367 | 111682 | -1 | 102 | 109 | 7 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 418 | Drift | 00:54:13.550 | 195213 | +1 | 139 | 132 | 7 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 419 | Drift | 01:01:46.533 | 222392 | +1 | 175 | 168 | 7 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 420 | Drift | 01:04:11.517 | 231091 | -1 | 161 | 154 | 7 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 421 | Drift | 01:15:05.500 | 270330 | -1 | 115 | 122 | 7 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 422 | Drift | 01:16:25.500 | 275130 | -1 | 113 | 106 | 7 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 423 | Drift | 01:17:37.517 | 279451 | +1 | 116 | 109 | 7 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 424 | Drift | 01:18:31.517 | 282691 | +1 | 118 | 111 | 7 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 425 | Drift | 01:19:30.500 | 286230 | -1 | 99 | 106 | 7 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 426 | Drift | 01:25:58.500 | 309510 | +1 | 191 | 198 | 7 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 427 | Drift | 01:37:55.433 | 352526 | +1 | 224 | 217 | 7 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 428 | Drift | 02:20:51.217 | 507073 | -1 | 314 | 321 | 7 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 429 | Drift | 02:23:28.183 | 516491 | -1 | 119 | 112 | 7 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 430 | Drift | 00:13:57.800 | 50268 | -1 | 111 | 117 | 6 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 431 | Drift | 00:14:49.817 | 53389 | +1 | 136 | 130 | 6 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 432 | Drift | 00:17:20.483 | 62429 | +1 | 115 | 121 | 6 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 433 | Drift | 00:45:08.333 | 162500 | +1 | 132 | 126 | 6 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 434 | Drift | 00:49:08.533 | 176912 | -1 | 151 | 145 | 6 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 435 | Drift | 00:55:11.533 | 198692 | -1 | 138 | 144 | 6 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 436 | Drift | 01:15:25.517 | 271531 | +1 | 115 | 121 | 6 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 437 | Drift | 01:17:43.500 | 279810 | -1 | 117 | 123 | 6 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 438 | Drift | 01:17:45.517 | 279931 | +1 | 120 | 114 | 6 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 439 | Drift | 01:23:03.483 | 299009 | -1 | 197 | 191 | 6 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 440 | Drift | 01:26:01.483 | 309689 | -1 | 197 | 191 | 6 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 441 | Drift | 01:50:53.383 | 399203 | +1 | 187 | 181 | 6 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 442 | Drift | 01:54:16.333 | 411380 | -1 | 334 | 340 | 6 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 443 | Drift | 02:04:53.333 | 449600 | +1 | 180 | 174 | 6 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 444 | Drift | 02:16:56.233 | 492974 | -1 | 335 | 329 | 6 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 445 | Drift | 00:17:42.467 | 63748 | -1 | 111 | 106 | 5 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 446 | Drift | 00:25:18.450 | 91107 | -1 | 146 | 151 | 5 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 447 | Drift | 00:44:29.333 | 160160 | +1 | 108 | 113 | 5 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 448 | Drift | 00:46:28.333 | 167300 | +1 | 129 | 134 | 5 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 449 | Drift | 00:51:07.533 | 184052 | -1 | 135 | 140 | 5 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 450 | Drift | 01:18:01.500 | 280890 | -1 | 117 | 122 | 5 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 451 | Drift | 01:18:29.500 | 282570 | -1 | 111 | 116 | 5 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 452 | Drift | 01:18:48.517 | 283711 | +1 | 117 | 112 | 5 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 453 | Drift | 01:18:53.517 | 284011 | +1 | 107 | 102 | 5 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 454 | Drift | 01:19:26.517 | 285991 | +1 | 108 | 103 | 5 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 455 | Drift | 01:25:31.483 | 307889 | -1 | 173 | 178 | 5 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 456 | Drift | 01:26:33.483 | 311609 | -1 | 225 | 230 | 5 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 457 | Drift | 01:37:31.417 | 351085 | -1 | 190 | 185 | 5 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 458 | Drift | 02:08:18.300 | 461898 | -1 | 125 | 130 | 5 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 459 | Drift | 00:12:22.867 | 44572 | +1 | 113 | 117 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 460 | Drift | 00:13:50.817 | 49849 | +1 | 112 | 108 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 461 | Drift | 00:17:51.483 | 64289 | +1 | 134 | 130 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 462 | Drift | 00:22:27.467 | 80848 | +1 | 240 | 244 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 463 | Drift | 00:27:05.467 | 97528 | +1 | 158 | 162 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 464 | Drift | 00:30:34.383 | 110063 | +1 | 113 | 109 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 465 | Drift | 00:40:21.350 | 145281 | +1 | 103 | 99 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 466 | Drift | 00:40:39.350 | 146361 | +1 | 96 | 100 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 467 | Drift | 00:49:22.533 | 177752 | -1 | 122 | 126 | 4 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 468 | Drift | 00:51:58.550 | 187113 | +1 | 136 | 132 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 469 | Drift | 00:55:52.550 | 201153 | +1 | 118 | 114 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 470 | Drift | 01:11:48.533 | 258512 | +1 | 342 | 338 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 471 | Drift | 01:15:27.500 | 271650 | -1 | 120 | 116 | 4 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 472 | Drift | 01:18:23.517 | 282211 | +1 | 116 | 112 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 473 | Drift | 01:19:02.500 | 284550 | -1 | 113 | 109 | 4 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 474 | Drift | 01:19:42.517 | 286951 | +1 | 105 | 101 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 475 | Drift | 01:22:22.483 | 296549 | -1 | 201 | 205 | 4 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 476 | Drift | 01:22:43.500 | 297810 | +1 | 180 | 184 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 477 | Drift | 01:23:21.500 | 300090 | +1 | 177 | 173 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 478 | Drift | 01:23:23.483 | 300209 | -1 | 181 | 185 | 4 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 479 | Drift | 01:24:21.500 | 303690 | +1 | 170 | 166 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 480 | Drift | 01:24:53.500 | 305610 | +1 | 183 | 179 | 4 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 481 | Drift | 02:19:40.233 | 502814 | -1 | 108 | 112 | 4 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 482 | Drift | 00:14:39.800 | 52788 | -1 | 123 | 126 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 483 | Drift | 00:17:37.467 | 63448 | -1 | 116 | 113 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 484 | Drift | 00:19:06.450 | 68787 | -1 | 139 | 136 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 485 | Drift | 00:22:23.450 | 80607 | -1 | 176 | 173 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 486 | Drift | 00:22:40.467 | 81628 | +1 | 178 | 175 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 487 | Drift | 00:26:59.450 | 97167 | -1 | 170 | 173 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 488 | Drift | 00:31:12.333 | 112340 | -2 | 136 | 139 | 3 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 489 | Drift | 00:40:25.333 | 145520 | -1 | 89 | 86 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 490 | Drift | 00:42:50.317 | 154219 | -1 | 220 | 223 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 491 | Drift | 00:44:58.333 | 161900 | +1 | 115 | 118 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 492 | Drift | 00:46:20.317 | 166819 | -1 | 127 | 124 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 493 | Drift | 00:48:00.550 | 172833 | +1 | 136 | 133 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 494 | Drift | 00:57:03.533 | 205412 | -1 | 122 | 125 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 495 | Drift | 01:14:57.517 | 269851 | +1 | 126 | 123 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 496 | Drift | 01:16:00.500 | 273630 | -1 | 120 | 117 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 497 | Drift | 01:17:27.500 | 278850 | -1 | 113 | 110 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 498 | Drift | 01:17:47.500 | 280050 | -1 | 117 | 120 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 499 | Drift | 01:19:11.517 | 285091 | +1 | 104 | 101 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 500 | Drift | 01:19:36.500 | 286590 | -1 | 112 | 109 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 501 | Drift | 01:20:11.517 | 288691 | +1 | 110 | 107 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 502 | Drift | 01:20:13.500 | 288810 | -1 | 104 | 107 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 503 | Drift | 01:25:18.500 | 307110 | +1 | 213 | 216 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 504 | Drift | 01:25:20.483 | 307229 | -1 | 203 | 200 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 505 | Drift | 01:28:42.483 | 319349 | -1 | 173 | 170 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 506 | Drift | 01:51:24.383 | 401063 | +1 | 160 | 163 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 507 | Drift | 02:21:58.217 | 511093 | -1 | 102 | 105 | 3 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 508 | Drift | 02:24:01.200 | 518472 | +1 | 99 | 102 | 3 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 509 | Drift | 00:14:21.817 | 51709 | +1 | 103 | 101 | 2 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 510 | Drift | 00:14:30.800 | 52248 | -1 | 101 | 103 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 511 | Drift | 00:22:32.450 | 81147 | -1 | 170 | 172 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 512 | Drift | 00:22:56.467 | 82588 | +1 | 152 | 154 | 2 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 513 | Drift | 00:34:17.350 | 123441 | +1 | 99 | 97 | 2 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 514 | Drift | 00:34:21.333 | 123680 | -1 | 93 | 91 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 515 | Drift | 00:36:29.333 | 131360 | -1 | 91 | 89 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 516 | Drift | 00:43:43.333 | 157400 | +1 | 107 | 109 | 2 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 517 | Drift | 00:45:06.317 | 162379 | -1 | 114 | 116 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 518 | Drift | 00:45:40.317 | 164419 | -1 | 153 | 155 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 519 | Drift | 00:46:26.317 | 167179 | -1 | 116 | 118 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 520 | Drift | 00:48:07.533 | 173252 | -1 | 128 | 126 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 521 | Drift | 00:48:55.533 | 176132 | -1 | 149 | 151 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 522 | Drift | 00:49:17.533 | 177452 | -1 | 135 | 137 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 523 | Drift | 00:50:45.533 | 182732 | -1 | 124 | 126 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 524 | Drift | 01:04:42.533 | 232952 | +1 | 350 | 352 | 2 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 525 | Drift | 01:11:18.517 | 256711 | -1 | 179 | 177 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 526 | Drift | 01:15:46.517 | 272791 | +1 | 112 | 110 | 2 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 527 | Drift | 01:16:33.500 | 275610 | -1 | 116 | 118 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 528 | Drift | 01:18:46.500 | 283590 | -1 | 117 | 115 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 529 | Drift | 01:22:45.483 | 297929 | -1 | 195 | 193 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 530 | Drift | 01:23:42.500 | 301350 | +1 | 194 | 196 | 2 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 531 | Drift | 01:24:44.483 | 305069 | -1 | 189 | 187 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 532 | Drift | 01:25:43.483 | 308609 | -1 | 186 | 184 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 533 | Drift | 01:28:04.500 | 317070 | +1 | 186 | 184 | 2 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 534 | Drift | 01:37:53.417 | 352405 | -1 | 198 | 196 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 535 | Drift | 02:22:31.200 | 513072 | -1 | 229 | 231 | 2 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 536 | Drift | 00:13:46.800 | 49608 | -2 | 104 | 103 | 1 | phase moved -2 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 537 | Drift | 00:17:28.467 | 62908 | -1 | 115 | 114 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 538 | Drift | 00:17:46.467 | 63988 | -1 | 107 | 108 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 539 | Drift | 00:18:08.483 | 65309 | +1 | 118 | 117 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 540 | Drift | 00:20:49.450 | 74967 | -1 | 126 | 125 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 541 | Drift | 00:30:10.400 | 108624 | -1 | 107 | 108 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 542 | Drift | 00:30:20.417 | 109225 | +1 | 111 | 110 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 543 | Drift | 00:30:22.400 | 109344 | -1 | 111 | 110 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 544 | Drift | 00:30:48.383 | 110903 | +1 | 123 | 122 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 545 | Drift | 00:44:42.317 | 160939 | -1 | 120 | 121 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 546 | Drift | 00:45:22.333 | 163340 | +1 | 133 | 132 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 547 | Drift | 00:46:24.333 | 167060 | +1 | 141 | 140 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 548 | Drift | 00:47:29.317 | 170959 | -1 | 139 | 140 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 549 | Drift | 00:48:17.550 | 173853 | +1 | 131 | 132 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 550 | Drift | 00:50:41.550 | 182493 | +1 | 134 | 133 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 551 | Drift | 00:51:05.550 | 183933 | +1 | 124 | 125 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 552 | Drift | 00:54:17.533 | 195452 | -1 | 136 | 135 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 553 | Drift | 01:04:33.517 | 232411 | -1 | 314 | 315 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 554 | Drift | 01:16:13.517 | 274411 | +1 | 115 | 114 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 555 | Drift | 01:17:21.517 | 278491 | +1 | 118 | 119 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 556 | Drift | 01:19:17.500 | 285450 | -1 | 108 | 107 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 557 | Drift | 01:19:47.500 | 287250 | -1 | 106 | 105 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 558 | Drift | 01:21:57.483 | 295049 | -1 | 180 | 179 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 559 | Drift | 02:22:25.233 | 512714 | +1 | 93 | 92 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 560 | Drift | 02:23:12.217 | 515533 | +1 | 105 | 104 | 1 | phase moved +1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 561 | Drift | 02:23:52.183 | 517931 | -1 | 103 | 102 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 562 | Drift | 02:24:03.183 | 518591 | -1 | 92 | 91 | 1 | phase moved -1 frame(s): recorder drift or a cut within 2 frames of a whole second |
| 563 | Gap | 00:00:14.517 | 871 |  |  |  |  | overlay unreadable for 29400 frames (490.0 s) |
| 564 | Gap | 01:29:37.667 | 322660 |  |  |  |  | overlay unreadable for 26690 frames (444.8 s) |
| 565 | Gap | 02:06:08.517 | 454111 |  |  |  |  | overlay unreadable for 456 frames (7.6 s) |
| 566 | Gap | 02:06:46.850 | 456411 |  |  |  |  | overlay unreadable for 121 frames (2.0 s) |
| 567 | Gap | 02:06:48.900 | 456534 |  |  |  |  | overlay unreadable for 1236 frames (20.6 s) |
| 568 | Gap | 02:07:12.633 | 457958 |  |  |  |  | overlay unreadable for 162 frames (2.7 s) |
| 569 | Gap | 02:07:15.350 | 458121 |  |  |  |  | overlay unreadable for 1415 frames (23.6 s) |
| 570 | Gap | 02:07:39.450 | 459567 |  |  |  |  | overlay unreadable for 131 frames (2.2 s) |
| 571 | Gap | 02:07:43.467 | 459808 |  |  |  |  | overlay unreadable for 162 frames (2.7 s) |
| 572 | Gap | 02:07:46.183 | 459971 |  |  |  |  | overlay unreadable for 107 frames (1.8 s) |
| 573 | Gap | 02:07:48.000 | 460080 |  |  |  |  | overlay unreadable for 120 frames (2.0 s) |
| 574 | Gap | 02:07:51.817 | 460309 |  |  |  |  | overlay unreadable for 110 frames (1.8 s) |
| 575 | Gap | 02:07:53.767 | 460426 |  |  |  |  | overlay unreadable for 94 frames (1.6 s) |
| 576 | Gap | 02:07:55.367 | 460522 |  |  |  |  | overlay unreadable for 260 frames (4.3 s) |
| 577 | Gap | 02:07:59.917 | 460795 |  |  |  |  | overlay unreadable for 118 frames (2.0 s) |
| 578 | Gap | 02:08:04.033 | 461042 |  |  |  |  | overlay unreadable for 102 frames (1.7 s) |
| 579 | Gap | 02:08:08.117 | 461287 |  |  |  |  | overlay unreadable for 116 frames (1.9 s) |
| 580 | Gap | 02:08:12.133 | 461528 |  |  |  |  | overlay unreadable for 179 frames (3.0 s) |
| 581 | Gap | 02:08:16.600 | 461796 |  |  |  |  | overlay unreadable for 88 frames (1.5 s) |
| 582 | Gap | 02:08:20.150 | 462009 |  |  |  |  | overlay unreadable for 112 frames (1.9 s) |
| 583 | Gap | 02:08:22.683 | 462161 |  |  |  |  | overlay unreadable for 115 frames (1.9 s) |
| 584 | Gap | 02:08:41.583 | 463295 |  |  |  |  | overlay unreadable for 354 frames (5.9 s) |
| 585 | Gap | 02:08:48.417 | 463705 |  |  |  |  | overlay unreadable for 95 frames (1.6 s) |
| 586 | Gap | 02:09:15.633 | 465338 |  |  |  |  | overlay unreadable for 82 frames (1.4 s) |
| 587 | Gap | 02:09:40.550 | 466833 |  |  |  |  | overlay unreadable for 1744 frames (29.1 s) |
| 588 | Gap | 02:10:11.217 | 468673 |  |  |  |  | overlay unreadable for 7439 frames (124.0 s) |
| 589 | Gap | 02:24:40.233 | 520814 |  |  |  |  | overlay unreadable for 96 frames (1.6 s) |
| 590 | Gap | 02:24:46.617 | 521197 |  |  |  |  | overlay unreadable for 138 frames (2.3 s) |
| 591 | Gap | 02:24:50.083 | 521405 |  |  |  |  | overlay unreadable for 311 frames (5.2 s) |
| 592 | Gap | 02:24:56.750 | 521805 |  |  |  |  | overlay unreadable for 571 frames (9.5 s) |
| 593 | Gap | 02:25:06.500 | 522390 |  |  |  |  | overlay unreadable for 138 frames (2.3 s) |
| 594 | Gap | 02:25:23.583 | 523415 |  |  |  |  | overlay unreadable for 182 frames (3.0 s) |
| 595 | Gap | 02:25:37.483 | 524249 |  |  |  |  | overlay unreadable for 383 frames (6.4 s) |
| 596 | Gap | 02:25:45.900 | 524754 |  |  |  |  | overlay unreadable for 155 frames (2.6 s) |
| 597 | Gap | 02:25:48.817 | 524929 |  |  |  |  | overlay unreadable for 117 frames (1.9 s) |
| 598 | Gap | 02:25:50.900 | 525054 |  |  |  |  | overlay unreadable for 892 frames (14.9 s) |
| 599 | Gap | 02:26:06.167 | 525970 |  |  |  |  | overlay unreadable for 365 frames (6.1 s) |
| 600 | Gap | 02:26:19.250 | 526755 |  |  |  |  | overlay unreadable for 120 frames (2.0 s) |
| 601 | Gap | 02:26:24.383 | 527063 |  |  |  |  | overlay unreadable for 225 frames (3.8 s) |
| 602 | Gap | 02:26:28.183 | 527291 |  |  |  |  | overlay unreadable for 574 frames (9.6 s) |
| 603 | Gap | 02:26:37.767 | 527866 |  |  |  |  | overlay unreadable for 79 frames (1.3 s) |
| 604 | Gap | 02:26:40.250 | 528015 |  |  |  |  | overlay unreadable for 82 frames (1.4 s) |
| 605 | Gap | 02:26:45.717 | 528343 |  |  |  |  | overlay unreadable for 257 frames (4.3 s) |
| 606 | Gap | 02:26:50.050 | 528603 |  |  |  |  | overlay unreadable for 414 frames (6.9 s) |
| 607 | Gap | 02:26:57.150 | 529029 |  |  |  |  | overlay unreadable for 295 frames (4.9 s) |
| 608 | Gap | 02:27:02.517 | 529351 |  |  |  |  | overlay unreadable for 483 frames (8.1 s) |
| 609 | Gap | 02:27:11.467 | 529888 |  |  |  |  | overlay unreadable for 384 frames (6.4 s) |
| 610 | Gap | 02:27:18.150 | 530289 |  |  |  |  | overlay unreadable for 81 frames (1.4 s) |
| 611 | Gap | 02:27:20.283 | 530417 |  |  |  |  | overlay unreadable for 140 frames (2.3 s) |
| 612 | Gap | 02:27:23.183 | 530591 |  |  |  |  | overlay unreadable for 61 frames (1.0 s) |
| 613 | Gap | 02:27:25.267 | 530716 |  |  |  |  | overlay unreadable for 94 frames (1.6 s) |
| 614 | Gap | 02:27:27.283 | 530837 |  |  |  |  | overlay unreadable for 206 frames (3.4 s) |
| 615 | Gap | 02:27:31.267 | 531076 |  |  |  |  | overlay unreadable for 92 frames (1.5 s) |
| 616 | Gap | 02:27:33.417 | 531205 |  |  |  |  | overlay unreadable for 127 frames (2.1 s) |
| 617 | Gap | 02:27:36.050 | 531363 |  |  |  |  | overlay unreadable for 69 frames (1.1 s) |
| 618 | Gap | 02:27:37.317 | 531439 |  |  |  |  | overlay unreadable for 391 frames (6.5 s) |
| 619 | Gap | 02:27:44.167 | 531850 |  |  |  |  | overlay unreadable for 116 frames (1.9 s) |
| 620 | Gap | 02:27:47.850 | 532071 |  |  |  |  | overlay unreadable for 167 frames (2.8 s) |
| 621 | Gap | 02:27:53.050 | 532383 |  |  |  |  | overlay unreadable for 109 frames (1.8 s) |
| 622 | Gap | 02:27:55.017 | 532501 |  |  |  |  | overlay unreadable for 81 frames (1.4 s) |
| 623 | Gap | 02:27:58.033 | 532682 |  |  |  |  | overlay unreadable for 63 frames (1.1 s) |
| 624 | Gap | 02:27:59.167 | 532750 |  |  |  |  | overlay unreadable for 300 frames (5.0 s) |
| 625 | Gap | 02:28:07.233 | 533234 |  |  |  |  | overlay unreadable for 318 frames (5.3 s) |
| 626 | Gap | 02:28:14.483 | 533669 |  |  |  |  | overlay unreadable for 648 frames (10.8 s) |
| 627 | Gap | 02:28:31.017 | 534661 |  |  |  |  | overlay unreadable for 75 frames (1.2 s) |
| 628 | Gap | 02:28:32.433 | 534746 |  |  |  |  | overlay unreadable for 538 frames (9.0 s) |
| 629 | Gap | 02:28:46.083 | 535565 |  |  |  |  | overlay unreadable for 61 frames (1.0 s) |
| 630 | Gap | 02:28:48.000 | 535680 |  |  |  |  | overlay unreadable for 245 frames (4.1 s) |
| 631 | Gap | 02:28:52.167 | 535930 |  |  |  |  | overlay unreadable for 252 frames (4.2 s) |
| 632 | Gap | 02:28:56.717 | 536203 |  |  |  |  | overlay unreadable for 150 frames (2.5 s) |
| 633 | Gap | 02:29:00.683 | 536441 |  |  |  |  | overlay unreadable for 90 frames (1.5 s) |
| 634 | Gap | 02:29:02.550 | 536553 |  |  |  |  | overlay unreadable for 138 frames (2.3 s) |
| 635 | Gap | 02:29:06.367 | 536782 |  |  |  |  | overlay unreadable for 112 frames (1.9 s) |
| 636 | Gap | 02:29:08.317 | 536899 |  |  |  |  | overlay unreadable for 67 frames (1.1 s) |
| 637 | Gap | 02:29:09.450 | 536967 |  |  |  |  | overlay unreadable for 177 frames (3.0 s) |
| 638 | Gap | 02:29:13.683 | 537221 |  |  |  |  | overlay unreadable for 476 frames (7.9 s) |
| 639 | Gap | 02:29:21.917 | 537715 |  |  |  |  | overlay unreadable for 321 frames (5.3 s) |
| 640 | Gap | 02:29:27.283 | 538037 |  |  |  |  | overlay unreadable for 193 frames (3.2 s) |
| 641 | Gap | 02:29:30.583 | 538235 |  |  |  |  | overlay unreadable for 328 frames (5.5 s) |
| 642 | Gap | 02:29:36.083 | 538565 |  |  |  |  | overlay unreadable for 140 frames (2.3 s) |
| 643 | Gap | 02:29:39.533 | 538772 |  |  |  |  | overlay unreadable for 428 frames (7.1 s) |
| 644 | Gap | 02:29:46.733 | 539204 |  |  |  |  | overlay unreadable for 83 frames (1.4 s) |
| 645 | Gap | 02:29:49.267 | 539356 |  |  |  |  | overlay unreadable for 84 frames (1.4 s) |
| 646 | Gap | 02:29:53.350 | 539601 |  |  |  |  | overlay unreadable for 203 frames (3.4 s) |
| 647 | Gap | 02:29:58.400 | 539904 |  |  |  |  | overlay unreadable for 232 frames (3.9 s) |
| 648 | Gap | 02:30:04.817 | 540289 |  |  |  |  | overlay unreadable for 339 frames (5.7 s) |
| 649 | Gap | 02:30:12.250 | 540735 |  |  |  |  | overlay unreadable for 160 frames (2.7 s) |
| 650 | Gap | 02:30:15.533 | 540932 |  |  |  |  | overlay unreadable for 108 frames (1.8 s) |
| 651 | Gap | 02:30:21.000 | 541260 |  |  |  |  | overlay unreadable for 184 frames (3.1 s) |
| 652 | Gap | 02:30:24.267 | 541456 |  |  |  |  | overlay unreadable for 135 frames (2.2 s) |
| 653 | Gap | 02:30:33.933 | 542036 |  |  |  |  | overlay unreadable for 509 frames (8.5 s) |
| 654 | Gap | 02:30:49.033 | 542942 |  |  |  |  | overlay unreadable for 129 frames (2.1 s) |
| 655 | Gap | 02:30:51.767 | 543106 |  |  |  |  | overlay unreadable for 380 frames (6.3 s) |
| 656 | Gap | 02:30:58.117 | 543487 |  |  |  |  | overlay unreadable for 236 frames (3.9 s) |
| 657 | Gap | 02:31:02.067 | 543724 |  |  |  |  | overlay unreadable for 305 frames (5.1 s) |
| 658 | Gap | 02:31:07.683 | 544061 |  |  |  |  | overlay unreadable for 338 frames (5.6 s) |
| 659 | Gap | 02:31:13.383 | 544403 |  |  |  |  | overlay unreadable for 86 frames (1.4 s) |
| 660 | Gap | 02:31:14.967 | 544498 |  |  |  |  | overlay unreadable for 132 frames (2.2 s) |
| 661 | Gap | 02:31:24.050 | 545043 |  |  |  |  | overlay unreadable for 239 frames (4.0 s) |
| 662 | Gap | 02:31:28.117 | 545287 |  |  |  |  | overlay unreadable for 320 frames (5.3 s) |
| 663 | Gap | 02:31:36.567 | 545794 |  |  |  |  | overlay unreadable for 483 frames (8.1 s) |
| 664 | Gap | 02:31:46.900 | 546414 |  |  |  |  | overlay unreadable for 66 frames (1.1 s) |
| 665 | Gap | 02:31:48.017 | 546481 |  |  |  |  | overlay unreadable for 231 frames (3.9 s) |
| 666 | Gap | 02:32:02.650 | 547359 |  |  |  |  | overlay unreadable for 615 frames (10.2 s) |
| 667 | Gap | 02:32:14.450 | 548067 |  |  |  |  | overlay unreadable for 145 frames (2.4 s) |
| 668 | Gap | 02:32:16.883 | 548213 |  |  |  |  | overlay unreadable for 316 frames (5.3 s) |
| 669 | Gap | 02:32:24.600 | 548676 |  |  |  |  | overlay unreadable for 214 frames (3.6 s) |
| 670 | Gap | 02:32:31.300 | 549078 |  |  |  |  | overlay unreadable for 333 frames (5.5 s) |
| 671 | Gap | 02:32:37.117 | 549427 |  |  |  |  | overlay unreadable for 86 frames (1.4 s) |
| 672 | Gap | 02:32:38.833 | 549530 |  |  |  |  | overlay unreadable for 254 frames (4.2 s) |
| 673 | Gap | 02:32:43.517 | 549811 |  |  |  |  | overlay unreadable for 157 frames (2.6 s) |
| 674 | Gap | 02:32:48.183 | 550091 |  |  |  |  | overlay unreadable for 109 frames (1.8 s) |
| 675 | Gap | 02:32:50.017 | 550201 |  |  |  |  | overlay unreadable for 256 frames (4.3 s) |
| 676 | Gap | 02:32:55.783 | 550547 |  |  |  |  | overlay unreadable for 75 frames (1.2 s) |
| 677 | Gap | 02:32:58.467 | 550708 |  |  |  |  | overlay unreadable for 327 frames (5.5 s) |
| 678 | Gap | 02:33:04.433 | 551066 |  |  |  |  | overlay unreadable for 89 frames (1.5 s) |
| 679 | Gap | 02:33:06.417 | 551185 |  |  |  |  | overlay unreadable for 201 frames (3.4 s) |
| 680 | Gap | 02:33:17.967 | 551878 |  |  |  |  | overlay unreadable for 219 frames (3.6 s) |
| 681 | Gap | 02:33:22.100 | 552126 |  |  |  |  | overlay unreadable for 427 frames (7.1 s) |
| 682 | Gap | 02:33:31.400 | 552684 |  |  |  |  | overlay unreadable for 284 frames (4.7 s) |
| 683 | Gap | 02:33:36.183 | 552971 |  |  |  |  | overlay unreadable for 117 frames (1.9 s) |
| 684 | Gap | 02:33:38.167 | 553090 |  |  |  |  | overlay unreadable for 352 frames (5.9 s) |
| 685 | Gap | 02:33:44.050 | 553443 |  |  |  |  | overlay unreadable for 401 frames (6.7 s) |
| 686 | Gap | 02:33:50.917 | 553855 |  |  |  |  | overlay unreadable for 823 frames (13.7 s) |
| 687 | Gap | 02:34:04.967 | 554698 |  |  |  |  | overlay unreadable for 676 frames (11.3 s) |
| 688 | Gap | 02:34:16.433 | 555386 |  |  |  |  | overlay unreadable for 209 frames (3.5 s) |
| 689 | Gap | 02:34:20.550 | 555633 |  |  |  |  | overlay unreadable for 144 frames (2.4 s) |
| 690 | Gap | 02:34:25.133 | 555908 |  |  |  |  | overlay unreadable for 230 frames (3.8 s) |
| 691 | Gap | 02:34:32.717 | 556363 |  |  |  |  | overlay unreadable for 196 frames (3.3 s) |
| 692 | Gap | 02:34:38.383 | 556703 |  |  |  |  | overlay unreadable for 88 frames (1.5 s) |
| 693 | Gap | 02:34:40.833 | 556850 |  |  |  |  | overlay unreadable for 68 frames (1.1 s) |
| 694 | Gap | 02:34:43.733 | 557024 |  |  |  |  | overlay unreadable for 308 frames (5.1 s) |
| 695 | Gap | 02:34:49.267 | 557356 |  |  |  |  | overlay unreadable for 355 frames (5.9 s) |
| 696 | Gap | 02:34:55.367 | 557722 |  |  |  |  | overlay unreadable for 280 frames (4.7 s) |
| 697 | Gap | 02:35:00.333 | 558020 |  |  |  |  | overlay unreadable for 98 frames (1.6 s) |
| 698 | Gap | 02:35:06.800 | 558408 |  |  |  |  | overlay unreadable for 98 frames (1.6 s) |
| 699 | Gap | 02:35:11.983 | 558719 |  |  |  |  | overlay unreadable for 244 frames (4.1 s) |
| 700 | Gap | 02:35:22.567 | 559354 |  |  |  |  | overlay unreadable for 94 frames (1.6 s) |
| 701 | Gap | 02:35:24.717 | 559483 |  |  |  |  | overlay unreadable for 78 frames (1.3 s) |
| 702 | Gap | 02:35:27.983 | 559679 |  |  |  |  | overlay unreadable for 112 frames (1.9 s) |
| 703 | Gap | 02:35:30.750 | 559845 |  |  |  |  | overlay unreadable for 182 frames (3.0 s) |
| 704 | Gap | 02:35:35.383 | 560123 |  |  |  |  | overlay unreadable for 63 frames (1.1 s) |
| 705 | Gap | 02:35:39.417 | 560365 |  |  |  |  | overlay unreadable for 134 frames (2.2 s) |
| 706 | Gap | 02:35:42.133 | 560528 |  |  |  |  | overlay unreadable for 168 frames (2.8 s) |
| 707 | Gap | 02:35:44.967 | 560698 |  |  |  |  | overlay unreadable for 62 frames (1.0 s) |
