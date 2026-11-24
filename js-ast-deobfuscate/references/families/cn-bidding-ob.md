> F1 家族参考（文档 + 检测 + 配方）。**不自动跑**站点 pass；命中后指导 A 插件序与 B scaffold。

# 变种OB混淆

当样本是OB变种混淆时，使用这份规则。

识别信号：

- 仍然能看到 `_0x` 风格的标识符。
- 经过通用处理后，OB 家族的包装层依旧存在。

流水线建议：

- 将 OB 家族逻辑保留在专用适配器里，只给 OB 类样本复用。
- 适配器运行后，直接把 `loop/switch` 残留与参考 `decode` 结果对比。

当前残留重点：

- 仍然残留的直接 `loop/switch` 平坦化结构。
- 任何高于参考基线的 OB 风格命名或包装层痕迹。

## JAD F1 落地

- 检测：`node scripts/detect-family.mjs <input.js> [hint]`
- 配方：`scripts/family-registry.mjs` 中 id=`cn-bidding-ob`
- 站点专用 pass：仅作 B / 未来晋升候选，**禁止**默认挂进 REGISTRY A
