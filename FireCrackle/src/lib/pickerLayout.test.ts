import { describe, expect, it } from "vitest";
import { pickerLayout, PICKER_GAP, PICKER_GUTTER, PICKER_HEADER } from "./pickerLayout";

describe("adaptive fire sheet", () => {
  it("fits the same shared grid with two columns for one fluid source",()=>{
    expect(pickerLayout(94,1184,32,32,2)).toEqual({blocks:1,rowsPerBlock:32,cell:32});
  });
  it("uses two equal blocks in the tall sidebar from the reference", () => {
    expect(pickerLayout(445, 1240, 48)).toEqual({ blocks: 2, rowsPerBlock: 16, cell: 44 });
  });

  it("finds every equal division as the panel becomes wider and shorter", () => {
    for (const blocks of [1, 2, 4, 8, 16, 32]) {
      const cell = 32;
      const rows = 32 / blocks;
      const width = blocks * (PICKER_GUTTER + 4 * (cell + 4)) + (blocks - 1) * PICKER_GAP;
      const height = PICKER_HEADER + rows * (cell + 4);
      expect(pickerLayout(width, height, cell)).toEqual({ blocks, rowsPerBlock: rows, cell });
    }
  });

  it("keeps all rows in order exactly once for every panel shape", () => {
    for (const width of [150, 250, 445, 800, 1600]) {
      for (const height of [100, 300, 700, 1240]) {
        const layout = pickerLayout(width, height, 48);
        const rows = Array.from({ length: layout.blocks }, (_, block) =>
          Array.from({ length: layout.rowsPerBlock }, (_, offset) => block * layout.rowsPerBlock + offset),
        ).flat();
        expect(rows).toEqual(Array.from({ length: 32 }, (_, row) => row));
        expect(layout.cell).toBeGreaterThanOrEqual(16);
        expect(layout.cell).toBeLessThanOrEqual(48);
      }
    }
  });

  it("falls back to scrolling at a readable size for tiny panels", () => {
    expect(pickerLayout(70, 40, 48)).toEqual({ blocks: 1, rowsPerBlock: 32, cell: 16 });
    expect(pickerLayout(0, 0, 48)).toEqual({ blocks: 1, rowsPerBlock: 32, cell: 48 });
  });
});
