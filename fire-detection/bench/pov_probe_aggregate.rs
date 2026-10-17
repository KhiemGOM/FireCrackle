//! Offline arithmetic on canonical observations; no colour/veil/GUI detection rules.
use std::slice;

/// Caller provides contiguous arrays, 16xP weights, P hit bits, 33 row offsets,
/// equally long probe/cell arrays, and 2624 output doubles. Returns an error for
/// invalid indices. Python validates shapes before entering this trusted ABI.
#[no_mangle]
pub unsafe extern "C" fn aggregate(
    probes: usize,
    weights: *const f64,
    hits: *const u32,
    starts: *const usize,
    indices: *const usize,
    cells: *const u16,
    items: usize,
    output: *mut f64,
) -> i32 {
    if probes == 0
        || [
            weights as usize,
            hits as usize,
            starts as usize,
            indices as usize,
            cells as usize,
            output as usize,
        ]
        .contains(&0)
    {
        return -1;
    }
    let weights = slice::from_raw_parts(weights, 16 * probes);
    let hits = slice::from_raw_parts(hits, probes);
    let starts = slice::from_raw_parts(starts, 33);
    let indices = slice::from_raw_parts(indices, items);
    let cells = slice::from_raw_parts(cells, items);
    if starts[0] != 0
        || starts[32] != items
        || !starts.windows(2).all(|a| a[0] <= a[1])
        || indices.iter().any(|&i| i >= probes)
        || cells.iter().any(|&i| i >= 512)
    {
        return -2;
    }
    let out = slice::from_raw_parts_mut(output, 2624);
    out.fill(0.);
    let mut cell_mass = vec![0.; 16 * 512];
    let mut cell_sum = vec![0.; 16 * 512];
    for row in 0..32 {
        cell_mass.fill(0.);
        cell_sum.fill(0.);
        for j in starts[row]..starts[row + 1] {
            let k = indices[j];
            let cell = cells[j] as usize;
            let signed = if hits[k] & (1u32 << row) != 0 {
                1.
            } else {
                -1.
            };
            out[2560 + row] += signed;
            out[2592 + row] += 1.;
            for mask in 0..16 {
                let weight = weights[mask * probes + k];
                if weight > 0. {
                    let i = mask * 32 + row;
                    out[i] += weight * signed;
                    out[512 + i] += weight;
                    out[1024 + i] += 1.;
                    cell_mass[mask * 512 + cell] += weight;
                    cell_sum[mask * 512 + cell] += weight * signed;
                }
            }
        }
        for mask in 0..16 {
            let i = mask * 32 + row;
            for cell in 0..512 {
                let mass = cell_mass[mask * 512 + cell];
                if mass > 0. {
                    out[1536 + i] += cell_sum[mask * 512 + cell] / mass;
                    out[2048 + i] += 1.;
                }
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn weighted_probe_and_equal_cell_scores_are_distinct_and_neutral() {
        let weights = vec![1.; 16 * 3];
        let hits = vec![1u32, 1, 0];
        let mut starts = vec![3usize; 33];
        starts[0] = 0;
        let indices = vec![0usize, 1, 2];
        let cells = vec![0u16, 0, 1];
        let mut out = vec![0.; 2624];
        assert_eq!(
            unsafe {
                aggregate(
                    3,
                    weights.as_ptr(),
                    hits.as_ptr(),
                    starts.as_ptr(),
                    indices.as_ptr(),
                    cells.as_ptr(),
                    3,
                    out.as_mut_ptr(),
                )
            },
            0
        );
        assert_eq!(out[0], 1.);
        assert_eq!(out[512], 3.);
        assert_eq!(out[1536], 0.);
        assert_eq!(out[2048], 2.);
        let weights = vec![0.; 16 * 3];
        assert_eq!(
            unsafe {
                aggregate(
                    3,
                    weights.as_ptr(),
                    hits.as_ptr(),
                    starts.as_ptr(),
                    indices.as_ptr(),
                    cells.as_ptr(),
                    3,
                    out.as_mut_ptr(),
                )
            },
            0
        );
        assert_eq!(out[512], 0.);
        assert_eq!(out[2048], 0.);
    }
}
