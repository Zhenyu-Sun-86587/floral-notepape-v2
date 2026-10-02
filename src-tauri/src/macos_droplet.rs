//! Compact Mac-only droplet geometry. Icons float within a shared bubble.
pub struct Geometry {
    pub edge: f64,
    pub height: f64,
    pub document_height: f64,
    /// Top-left coordinates, matching hover and split placement.
    pub cells: Vec<[f64; 4]>,
}
pub fn geometry(count: usize) -> Geometry {
    if count <= 1 {
        return Geometry {
            edge: 40.0,
            height: 40.0,
            document_height: 40.0,
            cells: vec![[8.0, 8.0, 24.0, 24.0]],
        };
    }
    let columns = if count <= 4 {
        2
    } else if count <= 9 {
        3
    } else {
        4
    };
    let edge = columns as f64 * 24.0 + 20.0;
    let document_height = count.div_ceil(columns) as f64 * 24.0 + 20.0;
    let height = document_height.min(92.0);
    let cells = if count == 3 {
        vec![
            [22.0, 10.0, 24.0, 24.0],
            [10.0, 34.0, 24.0, 24.0],
            [34.0, 34.0, 24.0, 24.0],
        ]
    } else {
        (0..count)
            .map(|i| {
                [
                    10.0 + (i % columns) as f64 * 24.0,
                    10.0 + (i / columns) as f64 * 24.0,
                    24.0,
                    24.0,
                ]
            })
            .collect()
    };
    Geometry {
        edge,
        height,
        document_height,
        cells,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compact_members_fit_bubble_without_overlapping_hit_targets() {
        for count in 1..=12 {
            let g = geometry(count);
            assert!(g.edge <= 116.0 && g.height <= 92.0);
            for (i, c) in g.cells.iter().enumerate() {
                assert!(c[0] >= 0.0 && c[0] + c[2] <= g.edge && c[1] + c[3] <= g.document_height);
                for other in &g.cells[i + 1..] {
                    assert!((c[0] - other[0]).abs() >= 24.0 || (c[1] - other[1]).abs() >= 24.0);
                }
            }
        }
    }
    #[test]
    fn dense_members_keep_every_cell_in_scroll_document() {
        let g = geometry(40);
        assert!(g.document_height > g.height);
        assert_eq!(g.cells.len(), 40);
        assert!(g.cells.iter().all(|c| c[1] + c[3] <= g.document_height));
    }
}
