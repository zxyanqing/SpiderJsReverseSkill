# 通用补环境任务提示

什么时候读本文件：需要写给其他 agent 的任务提示时。

使用 $web-js-env-patcher，在本地运行目标网站的原始 JavaScript，完成必要环境适配，并依据实际消费方的反馈验证结果。仓库不含 `node_modules`；任务需要 DOM/jsdom、跑 skill 内 jsdom 示例或 `npm test` 时，agent 先在本 skill 根目录执行 `npm ci --ignore-scripts`（或 `npm install`），再继续。完成以声明验收等级为准，**默认 L2 = 消费接受 + 稳定性**（真实性独立分报，见 `references/validation.md`）。单次接受不算完成。跨层画像与值来源见 `references/fingerprint.md`。无浏览器也可从 HTML/脚本启动，见 `references/workflow.md`。接口实现、诊断、测试和报告都服务于这一目标。

已有材料：目标页面或资源、触发动作、本地入口、产物及消费方式、请求/响应或运行记录。材料不全时自行观察并继续可独立推进的工作。任务范围与交付遵从用户选择。授权规则见 `SKILL.md`。

获得授权后自主拆分执行：选型与验证见 `references/runtime-frameworks.md`、`references/validation.md`。静默探测、四类错误与正式无插桩见 `references/env-discovery.md`。需要隔离单项能力时用 `references/controlled-substitution.md`。DOM 状态来源统一专项见 `references/dom-state-unification.md`。

持续检查：行动是否推进总目标；组合后行为是否正确、测试是否可能假阳性；输入/分支/输出边界是否仍有未验证前提；新证据是否要求改解释或换方案。结果分别说明实现/定位/接受三状态与消费接受/稳定性/真实性三维度。
