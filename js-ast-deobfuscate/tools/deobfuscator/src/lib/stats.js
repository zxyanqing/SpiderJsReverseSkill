/**
 * C1 · 变化统计
 * 目标：为解混淆插件提供统一的 matched / changed / skipped 统计容器。
 */

/**
 * 创建一个插件实例的统计对象。
 * @param {string} name 插件名称，出现在组合报告里用于区分来源
 * @returns {{name: string, matched: number, changed: number, skipped: number, reasons: Record<string, number>}}
 */
export function createStats(name) {
  // matched：形状命中次数；changed：真实改写次数；skipped：因证据不足跳过次数
  // reasons：按跳过原因聚合，便于定位卡在哪条 guard
  return {
    name,
    matched: 0,
    changed: 0,
    skipped: 0,
    reasons: {},
  };
}

/**
 * 记录一次安全跳过（保留原 AST，不抛错）。
 * @param {{skipped: number, reasons: Record<string, number>}} stats 当前插件统计对象
 * @param {string} reason 可检索的跳过原因（如 dynamic-index）
 */
export function skip(stats, reason) {
  // 总跳过次数 +1；同一原因可累加，验收时 reasons[reason] 能反映出现次数
  stats.skipped += 1;
  stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
}
