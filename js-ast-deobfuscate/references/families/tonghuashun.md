> F1 家族参考（文档 + 检测 + 配方）。**不自动跑**站点 pass；命中后指导 A 插件序与 B scaffold。

# 同花顺

当样本属于同花顺，或属于相关的 split-order wrapper 家族时，使用这份规则。

识别信号：

- 残留的 `split('|')` 顺序字符串会驱动 `loop/switch` 平坦化。
- 在抵达真正的顺序字符串之前，包装对象还会层层指向其他包装对象。

流水线建议：

- 在 `flatten-array-control-flow.js` 之前插入专门的顺序源适配器。
- 不要默认把 `inline-literals` 当成这里的瓶颈解法。

当前残留重点：

- 尚未解开的 `split('|')` 顺序数组。
- 由多层包装对象驱动的剩余 `loop/switch` 代码块。

## JAD F1 落地

- 检测：`node scripts/detect-family.mjs <input.js> [hint]`
- 配方：`scripts/family-registry.mjs` 中 id=`tonghuashun`
- 站点专用 pass：仅作 B / 未来晋升候选，**禁止**默认挂进 REGISTRY A
