> F1 家族参考（文档 + 检测 + 配方）。**不自动跑**站点 pass；命中后指导 A 插件序与 B scaffold。

# 中华人民共和国公安部

当样本属于中华人民共和国公安部，并且符合 OB 家族特征时，使用这份规则。

识别信号：

- 存在 `_0x` 风格标识符以及 OB 家族的包装结构。
- 虽然与招投标样本属于同一家族，但 `loop/switch` 残留画像并不相同。

流水线建议：

- 复用共享的 OB 适配器，但为这种残留画像保留独立规则文档。
- 以直接 `loop/switch` 块是否降到参考基线作为成功判断标准。

当前残留重点：

- 经过 OB 适配器后依然存在的 `loop/switch` 平坦化残留。
- 持续存在的 `_0x` 命名或包装层差距。

## JAD F1 落地

- 检测：`node scripts/detect-family.mjs <input.js> [hint]`
- 配方：`scripts/family-registry.mjs` 中 id=`mps-ob`
- 站点专用 pass：仅作 B / 未来晋升候选，**禁止**默认挂进 REGISTRY A
