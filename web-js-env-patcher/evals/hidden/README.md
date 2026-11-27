# 隐藏评分与故障键（仅评分者）

本树包含各场景的 `fault.yaml`（注入位置／解法要点）与 `graders/`（评分断言）。

**默认不得**复制到被测 Agent 工作区。评测时由评分者持有，或按 `isolation.md` 挂载／注入；被测侧经 `scripts/run_eval_agent_isolated.mjs` 启动（可见 `AGENT_WS`＋`SKILL_CLEAN`）；`stage_eval_agent_workspace.mjs` 只是准备题面包，单独不算隔离。

题面与 `scenarios/*/workspace/` 可给被测方；本目录与 `case.yaml`、评分规则默认仅评分者可见。
