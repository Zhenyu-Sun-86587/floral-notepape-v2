/** 原生窗口拥有物理边界；DOM 只按同一计划分配实际 viewport，避免 DPI/缩放重复换算。 */
export function capsuleGeometry(slot: number, grip: number, viewport: number) {
  return {
    "--slot": `${(slot / viewport) * 100}%`,
    "--grip": `${(grip / viewport) * 100}%`,
  };
}
