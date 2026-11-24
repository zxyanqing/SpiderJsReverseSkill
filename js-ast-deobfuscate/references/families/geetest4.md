> F1 家族参考（文档 + 检测 + 配方）。**不自动跑**站点 pass；命中后指导 A 插件序与 B scaffold。

# 极验4

当样本属于极验4，或属于相近的 guarded-switch VM 家族时，使用这份规则。

识别信号：

- `loop/switch` 平坦化外层还包着 guarded `if` 结构。
- 即使通用平坦化器已经能处理较简单的 handler，输出与参考结果仍然差很多。

流水线建议：

- 将 guarded-switch 适配器作为家族专用步骤运行，不要塞进通用平坦化器内部。
- 优先压低直接 `loop/switch` 残留，再考虑命名或可读性层面的清理。

当前残留重点：

- 仍然残留的直接 `loop/switch` 热点。
- 仍然比 `decode.js` 更嘈杂的 guarded opcode dispatcher 结构。

## JAD F1 落地

- 检测：`node scripts/detect-family.mjs <input.js> [hint]`
- 配方：`scripts/family-registry.mjs` 中 id=`geetest4`
- 站点专用 pass：仅作 B / 未来晋升候选，**禁止**默认挂进 REGISTRY A
