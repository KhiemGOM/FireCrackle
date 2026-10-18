"""Exact vanilla 1.16.5 modular-clock research oracle; never edits/exports game assets.

Run with Python 3.10+: joint_modular_probe.py [--jar CLIENT.jar] [--plot FIGURE.png]
The optional explanatory plot needs matplotlib/numpy. All examples are synthetic.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import hashlib
import itertools
import json
import math
from pathlib import Path
import struct
from zipfile import ZipFile


@dataclass(frozen=True)
class Cycle:
    name: str
    frames: tuple[int, ...]
    rows: int
    sequence_positions: int
    default_duration: int
    metadata_sha256: str

    @property
    def period(self):
        return len(self.frames)

    def row(self, tick):
        """Periodic metadata row; separate the physical-tile-zero initial upload."""
        return self.frames[tick % self.period]

    def row_after_upload(self, age):
        # Sprite.upload() initially uploads physical0, until its first duration expires.
        assert age >= 0
        return 0 if age < self.default_duration else self.row(age)


def load_cycles(jar):
    result = {}
    with ZipFile(jar) as archive:
        for name in ("fire_0", "fire_1", "soul_fire_0", "soul_fire_1", "water_still", "water_flow", "lava_still", "lava_flow", "nether_portal"):
            path = f"assets/minecraft/textures/block/{name}.png"
            png = archive.read(path)
            width, height = struct.unpack(">II", png[16:24])
            raw = archive.read(path + ".mcmeta")
            meta = json.loads(raw)["animation"]
            # These exact vanilla assets have square tiles and no width/height overrides.
            assert not meta.get("interpolate", False)
            assert "width" not in meta and "height" not in meta
            tile = min(width, height)
            rows = width * height // (tile * tile)
            sequence = meta.get("frames", list(range(rows)))
            duration = meta.get("frametime", 1)
            frames = []
            for entry in sequence:
                row, dwell = (entry["index"], entry.get("time", duration)) if isinstance(entry, dict) else (entry, duration)
                frames.extend([row] * dwell)
            result[name] = Cycle(name, tuple(frames), rows, len(sequence), duration, hashlib.sha256(raw).hexdigest())
    return result


def candidates(cycles, observations, period=None):
    period = period or math.lcm(*(cycles[name].period for name in observations))
    return [n for n in range(period) if all(cycles[name].row(n) in rows for name, rows in observations.items())]


def examine(cycles):
    names = ("fire_1", "water_still", "lava_flow", "lava_still")
    clocks = [cycles[name] for name in names]
    assert [c.period for c in clocks] == [32, 64, 48, 76]
    assert all(cycles["fire_0"].row(n) == (cycles["fire_1"].row(n) + 16) % 32 for n in range(64))
    assert cycles["lava_still"].sequence_positions == 38
    assert cycles["fire_0"].row_after_upload(0) == cycles["fire_1"].row_after_upload(0) == 0
    assert cycles["fire_0"].row_after_upload(1) == 17
    assert cycles["fire_0"].row_after_upload(32) == 16
    period = math.lcm(*(c.period for c in clocks))
    states = [tuple(c.row(n) for c in clocks) for n in range(period)]
    histogram = Counter(states)
    assert period == 3648 and len(histogram) == 1920
    assert Counter(histogram.values()) == {1: 192, 2: 1728}
    # Same-frame contradiction, irrespective of any capture delay.
    assert candidates(cycles, {"fire_1": {0}, "water_still": {4}}) == []
    # Exact CRT's simple gcd rule agrees with brute force on all exact-residue pairs.
    for left, right in ((32, 64), (32, 48), (32, 76)):
        for a in range(left):
            for b in range(right):
                brute = any(n % right == b for n in range(a, math.lcm(left, right), left))
                assert brute == ((a - b) % math.gcd(left, right) == 0)
    # Joint temporal contradiction even though every standalone interval check passes.
    early, later = states[0][:3], states[64][:3]
    individual = {}
    for clock, a, b in zip(clocks[:3], early, later):
        individual[clock.name] = sorted({d for n in range(clock.period) if clock.row(n) == a for d in range(41) if clock.row(n + d) == b})
        assert individual[clock.name]
    joint_starts = [n for n in range(192) if states[n][:3] == early]
    assert joint_starts == [0]
    joint_deltas = [d for d in range(192) if all(clocks[i].row(d) == later[i] for i in range(3))]
    assert joint_deltas == [64] and not any(d <= 40 for d in joint_deltas)
    # The long joint period does not make the visible state injective.
    assert states[18] == states[210] == (18, 9, 6, 9)
    assert states[20] != states[212]
    pairs = {(a, b): {(s[a], s[b]) for s in states} for a, b in itertools.combinations(range(4), 2)}
    # Exhaustive result for exact rows only; not a general theorem for uncertain labels.
    pairwise_only = 0
    for rows in itertools.product(*(range(c.rows) for c in clocks)):
        if all((rows[a], rows[b]) in allowed for (a, b), allowed in pairs.items()) and rows not in histogram:
            pairwise_only += 1
    assert pairwise_only == 0
    # With ambiguous labels, all pairwise comparisons can pass while joint intersection is empty.
    ambiguous = ({0, 1}, {1, 2}, {0, 2})
    assert all(a & b for a, b in itertools.combinations(ambiguous, 2))
    assert not set.intersection(*ambiguous)
    summary = {
        "period_ticks": period, "period_seconds_at_20Hz": period / 20,
        "distinct_visible_tuples": len(histogram), "candidate_multiplicity_counts": dict(Counter(histogram.values())),
        "pairwise_legal_cell_counts": {f"{names[a]}+{names[b]}": len(values) for (a, b), values in pairs.items()},
        "standalone_advance_sets_in_0_to_40": individual, "joint_minimum_advance": min(joint_deltas),
        "alias_example": {"ticks": [18, 210], "visible_rows": list(states[18]), "distinguishes_after_ticks": 2},
        "exact_row_pairwise_pass_global_fail_count": pairwise_only,
        "asset_metadata": {name: {"rows": c.rows, "sequence_positions": c.sequence_positions, "default_duration_ticks": c.default_duration, "period_ticks": c.period, "mcmeta_sha256": c.metadata_sha256} for name, c in cycles.items()},
    }
    return summary, states


def plot(cycles, states, output):
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap
    import numpy as np

    plt.rcParams.update({"font.size": 11, "axes.titlesize": 13, "axes.labelsize": 11})
    fig, axes = plt.subplots(1, 3, figsize=(17, 5.1), gridspec_kw={"width_ratios": [1, 1, 1.35]})
    background, valid, bad = "#f1f3f6", "#197a86", "#c84a3e"
    for ax, index, title, ylabel in ((axes[0], 1, "A. Allowed pairs in one image", "Still water row (64-tick cycle)"), (axes[1], 3, "B. A folded cycle needs both branches", "Still lava row (76-tick cycle)")):
        rows = cycles["water_still" if index == 1 else "lava_still"].rows
        grid = np.zeros((rows, 32))
        for state in states:
            grid[state[index], state[0]] = 1
        ax.imshow(grid, origin="lower", extent=(-.5, 31.5, -.5, rows - .5), aspect="auto", interpolation="nearest", cmap=ListedColormap([background, valid]), vmin=0, vmax=1)
        ax.set(title=title, xlabel="Canonical fire step (32-tick cycle)", ylabel=ylabel)
        ax.set_xticks([0, 8, 16, 24, 31])
        ax.set_yticks([0, 8, 16, 24, 31] if index == 1 else [0, 4, 8, 12, 16, 19])
    axes[0].scatter([0], [4], marker="x", color=bad, s=130, linewidths=3)
    axes[0].annotate("Impossible together", (0, 4), xytext=(5, 7), color=bad, arrowprops={"arrowstyle": "->", "color": bad}, fontsize=10)
    axes[1].scatter([18], [9], facecolors="none", edgecolors="#202a38", s=140, linewidths=2)
    axes[1].text(1, 17, "Tick 18 and tick 210\ncan show the same rows", color="#202a38", fontsize=10, bbox={"facecolor": "white", "edgecolor": "none", "alpha": .9})
    ax = axes[2]
    series = [("Fire", {0, 32}), ("Still water", {0, 1}), ("Flowing lava", set(range(13, 18))), ("All three", set())]
    for row, (label, ticks) in enumerate(series):
        ax.hlines(row, 0, 40, color="#e1e5ea", linewidth=2)
        ax.scatter(sorted(ticks), [row] * len(ticks), color=valid, s=65)
    ax.set_yticks(range(4), [label for label, _ in series]); ax.invert_yaxis()
    ax.set(xlim=(-2, 42), ylim=(3.8, -.8), xlabel="Possible executed-tick advance", title="C. Each passes; their combination fails")
    ax.text(20, 3, "No shared advance in 0–40", color=bad, ha="center", va="center", fontsize=11)
    ax.text(20, 3.55, "The joint state requires at least 64 ticks", ha="center", fontsize=10)
    ax.set_xticks([0, 10, 20, 30, 40]); ax.grid(axis="x", alpha=.18)
    fig.suptitle("Different texture periods form constraints on one clock", fontsize=17, fontweight="bold", y=1.01)
    fig.text(.02, -.015, "Synthetic examples from verified vanilla Minecraft 1.16.5 metadata. Teal cells/marks are possible; pale cells are impossible. Not measured detection accuracy.", fontsize=10)
    fig.tight_layout(w_pad=2)
    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=150, bbox_inches="tight")
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, default=Path.home() / ".gradle/caches/fabric-loom/1.16.5/minecraft-client.jar")
    parser.add_argument("--plot", type=Path)
    args = parser.parse_args()
    cycles = load_cycles(args.jar)
    summary, states = examine(cycles)
    if args.plot:
        plot(cycles, states, args.plot)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
