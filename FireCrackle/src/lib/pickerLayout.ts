import { ROWS } from "./grid";

export const PICKER_GUTTER = 22;
export const PICKER_GAP = 12;
export const PICKER_HEADER = 32;

/** Find the largest readable sprites among every even division of the sheet. */
export function pickerLayout(width: number, height: number, preferredCell: number,rows=ROWS,columns=4) {
  const minimum = columns===2?32:16;
  const preferred = Number.isFinite(preferredCell) ? Math.max(minimum, Math.floor(preferredCell)) : minimum;
  if (!(width > 0) || !(height > 0)) return { blocks: 1, rowsPerBlock: rows, cell: preferred };

  let best = { blocks: 1, rowsPerBlock: rows, cell: minimum };
  let bestOverflow = Infinity;
  for (let blocks = 1; blocks <= rows; blocks *= 2) {
    const rowsPerBlock = Math.ceil(rows / blocks);
    const blockWidth = (width - PICKER_GAP * (blocks - 1)) / blocks;
    const across = Math.floor((blockWidth - PICKER_GUTTER) / columns - 4);
    // Keep one readable strip when even the narrowest block cannot fit.
    if (across < minimum && blocks > 1) continue;
    const down = Math.floor((height - PICKER_HEADER) / rowsPerBlock - 4);
    const cell = Math.max(minimum, Math.min(preferred, across, down));
    const overflow = Math.max(0, PICKER_HEADER + rowsPerBlock * (cell + 4) - height);
    if (overflow < bestOverflow || (overflow === bestOverflow && cell > best.cell)) {
      best = { blocks, rowsPerBlock, cell };
      bestOverflow = overflow;
    }
  }
  return best;
}
