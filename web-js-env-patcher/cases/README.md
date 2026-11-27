# 固定来源环境案例

本目录放**少量**固定上游的真实环境依赖案例，用于检验本地补环境组合，不替代任务级合成样例。

方法与边界见 `references/real-source-cases.md`。

| 案例 | 上游 | 环境子集 | 无外部 MCP |
| --- | --- | --- | --- |
| `fingerprintjs-local/` | FingerprintJS 5.2.0（固定 commit／哈希） | DOM／指纹读数／异步完成／**页面 Realm** | 是（jsdom 页内 UMD + 已准备 dist） |

额外上游树与 npm 包**默认不捆进发行包**；按各例 `prepare.mjs` 下载到输出目录后再跑。

**边界：** 本地模拟通过 ≠ 真实网站接受；不得推导风控绕过率。
