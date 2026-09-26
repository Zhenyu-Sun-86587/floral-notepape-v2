//! 边缘布局的唯一几何 authority。输入/输出均为逻辑像素，物理取整仅在窗口边界执行。
pub const SLOT: f64 = 44.0;
pub const GRIP: f64 = 14.0;
pub const CROSS: f64 = 18.0;
pub const MERGE: f64 = 52.0;
pub const GAP: f64 = 4.0;
#[derive(Clone, Debug, PartialEq)]
pub struct VisualGroup {
    pub members: Vec<String>,
    pub axis_start: f64,
    pub axis_length: f64,
    pub slot_length: f64,
    pub grip_length: f64,
    pub content_length: f64,
}

#[derive(Clone, Debug)]
pub struct CapsuleLayoutPlan {
    pub extent: f64,
    pub groups: Vec<VisualGroup>,
}

pub fn solve(
    mut items: Vec<(String, f64)>,
    extent: f64,
    slot: f64,
    grip: f64,
    merge: f64,
    gap: f64,
) -> CapsuleLayoutPlan {
    assert!(extent > 0.0 && slot > 0.0 && grip >= 0.0 && gap >= 0.0);
    for (_, offset) in &mut items {
        *offset = if offset.is_finite() {
            offset.clamp(0.0, 1.0)
        } else {
            0.5
        } * (extent - slot).max(0.0);
    }
    items.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
    let mut clusters: Vec<Vec<(String, f64)>> = Vec::new();
    for item in items {
        if clusters
            .last()
            .is_some_and(|last| item.1 - last.last().unwrap().1 <= merge)
        {
            clusters.last_mut().unwrap().push(item);
        } else {
            clusters.push(vec![item]);
        }
    }
    // 先在整条边缘消解冲突。边界夹紧导致的碰撞同样合并，再从头计算；
    // 每轮减少一个组，最多 n-1 轮，不会留下独立 clamp 后互相覆盖的窗口。
    loop {
        let groups: Vec<_> = clusters
            .iter()
            .map(|items| {
                let head = if items.len() > 1 { grip } else { 0.0 };
                let content = items.len() as f64 * slot + head;
                let length = content.min(extent);
                VisualGroup {
                    members: items.iter().map(|item| item.0.clone()).collect(),
                    axis_start: (items[0].1 - head).clamp(0.0, extent - length),
                    axis_length: length,
                    slot_length: slot,
                    grip_length: head,
                    content_length: content,
                }
            })
            .collect();
        if let Some(index) = groups
            .windows(2)
            .position(|pair| pair[0].axis_start + pair[0].axis_length + gap > pair[1].axis_start)
        {
            let right = clusters.remove(index + 1);
            clusters[index].extend(right);
        } else {
            return CapsuleLayoutPlan { extent, groups };
        }
    }
}

/// 只转换组的两个端点；当两个端点各自四舍五入会少半像素时，末端向外补至完整内容。
pub fn physical_interval(start: f64, length: f64, scale: f64) -> (i32, u32) {
    assert!(start >= 0.0 && length >= 0.0 && scale.is_finite() && scale > 0.0);
    let first = (start * scale).round() as i32;
    let last =
        (((start + length) * scale).round() as i32).max(first + (length * scale).ceil() as i32);
    (first, (last - first) as u32)
}

/// 一对一匹配最大成员交集；组内排序变化不改变窗口 identity。
pub fn reuse_indices(previous: &[Vec<String>], next: &[VisualGroup]) -> Vec<Option<usize>> {
    let mut candidates = Vec::new();
    for (old, members) in previous.iter().enumerate() {
        for (new, group) in next.iter().enumerate() {
            let count = group
                .members
                .iter()
                .filter(|key| members.contains(key))
                .count();
            if count > 0 {
                candidates.push((count, old, new));
            }
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let mut result = vec![None; next.len()];
    let mut used = vec![false; previous.len()];
    for (_, old, new) in candidates {
        if !used[old] && result[new].is_none() {
            result[new] = Some(old);
            used[old] = true;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn assert_layout_invariants(plan: &CapsuleLayoutPlan) {
        let mut end = 0.0;
        let mut keys = std::collections::HashSet::new();
        for group in &plan.groups {
            assert!(group.axis_start >= end);
            end = group.axis_start + group.axis_length;
            assert!(end <= plan.extent);
            assert_eq!(
                group.content_length,
                group.grip_length + group.slot_length * group.members.len() as f64
            );
            for key in &group.members {
                assert!(keys.insert(key));
            }
            // 超过物理容量只滚动统一 viewport，成员槽不缩小、不重叠。
            assert_eq!(group.axis_length, group.content_length.min(plan.extent));
        }
    }
    fn plan(positions: &[f64], extent: f64) -> CapsuleLayoutPlan {
        solve(
            positions
                .iter()
                .enumerate()
                .map(|(i, x)| (i.to_string(), x / (extent - SLOT)))
                .collect(),
            extent,
            SLOT,
            GRIP,
            MERGE,
            GAP,
        )
    }
    #[test]
    fn capsule_global_geometry_regressions() {
        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            for positions in [
                &[100.0, 110.0][..],
                &[100.0, 101.0, 160.0],
                &[100.0, 120.0, 140.0],
                &[100.0, 110.0, 400.0, 410.0],
                &[0.0, 1.0],
                &[950.0, 960.0],
                &[0.0, 60.0, 120.0, 180.0, 240.0, 300.0],
            ] {
                let p = plan(positions, 1000.0);
                assert_layout_invariants(&p);
                for group in &p.groups {
                    let (start, length) =
                        physical_interval(group.axis_start, group.axis_length, scale);
                    assert_eq!(start, (group.axis_start * scale).round() as i32);
                    assert!(
                        start + length as i32
                            >= ((group.axis_start + group.axis_length) * scale).round() as i32
                    );
                    assert!(length as f64 >= (group.axis_length * scale).ceil());
                }
                assert_eq!(
                    p.groups.iter().map(|g| g.members.len()).sum::<usize>(),
                    positions.len()
                );
            }
        }
        assert_eq!(plan(&[100.0, 101.0, 160.0], 1000.0).groups.len(), 1);
        assert_eq!(plan(&[100.0, 110.0, 400.0, 410.0], 1000.0).groups.len(), 2);
    }
    #[test]
    fn capsule_dense_capacity_and_identity() {
        let p = plan(&vec![0.0; 100], 200.0);
        assert_layout_invariants(&p);
        assert_eq!(p.groups.len(), 1);
        let groups = plan(&[100.0, 110.0, 400.0], 1000.0).groups;
        assert_eq!(
            reuse_indices(&[vec!["1".into(), "0".into()], vec!["2".into()]], &groups),
            vec![Some(0), Some(1)]
        );
        let merged = plan(&[100.0, 110.0, 120.0], 1000.0).groups;
        assert_eq!(
            reuse_indices(
                &groups.iter().map(|g| g.members.clone()).collect::<Vec<_>>(),
                &merged
            ),
            vec![Some(0)]
        );
        // 拆分后一个旧 identity 只能分配给一个新组，不能出现两个同 identity surface。
        assert_eq!(
            reuse_indices(&[merged[0].members.clone()], &groups),
            vec![Some(0), None]
        );
    }
    #[test]
    fn capsule_generated_edges_never_overlap() {
        let mut seed = 7_u64;
        for count in 0..80 {
            let items = (0..count)
                .map(|i| {
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                    (i.to_string(), (seed % 10000) as f64 / 10000.0)
                })
                .collect();
            assert_layout_invariants(&solve(items, 760.0, 55.0, 18.0, 65.0, 5.0));
        }
    }

    #[test]
    fn fractional_group_start_does_not_crop_the_final_slot() {
        // 125% 时独立 round 两端会得到 182px，但 14 + 3×44 的 DOM 需要 183px。
        let (start, length) = physical_interval(86.2, 146.0, 1.25);
        assert_eq!(start, (86.2_f64 * 1.25).round() as i32);
        assert_eq!(length, 183);
    }
}
