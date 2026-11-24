> F1 家族参考（文档 + 检测 + 配方）。**不自动跑**站点 pass；命中后指导 A 插件序与 B scaffold。

# 小红书

当样本属于小红书时，使用这份规则。

识别信号：

- wrapper 清理相对较轻，剩余平坦化也不算多。
- 可读性提升主要依赖结构规范化，而不是更深的求值或执行。

流水线建议：

- 让适配器保持轻量。
- 优先做规范化和包装层清理，而不是激进的常量传播。

当前残留重点：

- 仍然与 `decode.js` 存在差异的小型 dispatcher 或包装层残留。

## JAD F1 落地

- 检测：`node scripts/detect-family.mjs <input.js> [hint]`
- 配方：`scripts/family-registry.mjs` 中 id=`xiaohongshu`
- 站点专用 pass：仅作 B / 未来晋升候选，**禁止**默认挂进 REGISTRY A
