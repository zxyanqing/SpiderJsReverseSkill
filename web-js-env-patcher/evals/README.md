# 环境修复独立评测（Y05）

本目录是 **维护期** 用的独立 Agent 行为评测资产，不是用户补环境任务的前置清单。  
方法借鉴 O 的「新上下文 + 隐藏评分 + 过程证据」组织方式；**题目全部重写为补环境契约**，不考是否需要逆向／是否省略参数。

## 布局

| 路径 | 给谁 | 内容 |
| --- | --- | --- |
| `scenarios/<id>/prompt.md` | 被测 Agent | 题面（自然语言任务） |
| `scenarios/<id>/case.yaml` | 评测组织者 | 期望结果摘要（可给评分者；默认不塞进被测工作区） |
| `scenarios/<id>/workspace/` | 被测 Agent | 可运行输入／现象／消费观察入口 |
| `hidden/<id>/` | **仅评分者** | 故障注入位置、解法要点、grader 断言 |
| `scoring-rules.v1.md` | 评分者 | 版本化评分规则 |
| `compare-protocol.md` | 评测组织者 | 新旧 skill 对比协议 |
| `catalog.yaml` | 双方索引 | 场景 ↔ 环境故障类覆盖表 |

隐藏键默认不可读与挂载步骤见 **`isolation.md`**。  
**唯一默认启动**：`scripts/run_eval_agent_isolated.mjs`（Seatbelt 拒绝答案路径）。  
`stage_eval_agent_workspace.mjs`／`build_eval_skill_clean.mjs` 只是准备步骤，**单独不算隔离完成**。  
**不得**把 `hidden/`／`case.yaml`／`scoring-rules*` 默认拷进被测 Agent 工作区。

边界总述见 **`BOUNDARY.md`**（评测≠用户前置；执行器可分期；`evals/` 须进快照／diff）。

## 覆盖（本包）

见 `catalog.yaml`：对外 **E01–E07**（中性编号；标题亦中性）。具体故障类仅 `hidden/public-id-map.yaml`／各 `hidden/<id>/` 可见。  
暂存包泄露扫描：`evals/lib/leak-scan.mjs`（由 TEST-Y05 F1.3 覆盖）。

## 评分要点

- 评测通过 ≠ 真实网站接受；本地消费观察只证明声明的环境契约。  
- 无工具／执行记录 → 不得给执行分；仅追踪 stub 跑通而正式路径失败 → 不得给完成分。  
- 改过评分规则后，旧分不得与新分混比（规则版本见 `scoring-rules.v1.md`）。
