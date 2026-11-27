# 评测边界说明

1. **评测 ≠ 用户任务前置。** 普通补环境任务不需要先跑 `evals/`；本包供 skill 维护期做独立 Agent 行为对比。  
2. **执行器可分期。** 当前交付可执行 workspace、题面、隐藏键、评分规则与暂存脚本；完整自动调度／多 Agent 编排可后续接，不阻塞本包进入快照与 diff。  
3. **`$M/evals/` 须进快照与 diff。** 相对 baseline／各阶段快照应能看到本目录；禁止把评测根写到 `$M/../evals` 或其它 M 外路径。  
4. **本地观察 ≠ 网站接受。** 场景 consumer 通过只证明声明的环境契约，不得写成真实站点验收或绕过率。

5. **隔离启动唯一默认。** 被测进程须经 `scripts/run_eval_agent_isolated.mjs` 启动；仅 `stage_eval_agent_workspace`／独立 cwd／`NODE_PATH`／chmod **不算**隔离完成（见 `isolation.md`）。
