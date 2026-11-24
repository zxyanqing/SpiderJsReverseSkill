> F1 家族参考（文档 + 检测 + 配方）。**不自动跑**站点 pass；命中后指导 A 插件序与 B scaffold。

# 网易易盾

当样本属于网易易盾时，使用这份规则。

识别信号：

- 通用 dispatcher 处理之后，wrapper 仍然比较密集。
- 做一轮字面量传播通常仍然有帮助，而且不至于把文件推向病态体积。

流水线建议：

- 让 dispatcher 适配器尽量贴近 `inline-dispatchers` 这一步。
- 允许执行一轮 `inline-literals`，但不要盲目重复。

当前残留重点：

- 相对 `decode.js` 的 dispatcher 包装层数量差距。
- 主平坦化已经消除后，仍然存在的少量结构差距。

## JAD F1 落地

- 检测：`node scripts/detect-family.mjs <input.js> [hint]`
- 配方：`scripts/family-registry.mjs` 中 id=`yidun`
- 站点专用 pass：仅作 B / 未来晋升候选，**禁止**默认挂进 REGISTRY A
