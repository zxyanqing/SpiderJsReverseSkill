# 评分隔离（唯一默认启动方式）

评测被测进程与完整 `$M/evals` **评分树不得同属可读视图**。本 skill 在 **macOS** 上以 `sandbox-exec` 为**唯一默认**隔离启动器。

## 默认完成口径：受限可读视图（运行资源 allow-list）

默认交付必须是 **`(deny default)` + 明确放行表**，**禁止**无条件全局 `(allow file-read*)` 再靠「只 deny `/Users`」收口：

- 被测进程（含**子进程**）默认 **不可** 读任意路径
- **仅放行**（原则；实现见 `scripts/run_eval_agent_isolated.mjs`）：
  - `AGENT_WS/`、`SKILL_CLEAN/`、**本次**工作根（含启动器写入的 `tmp/`；逻辑路径＋realpath）
  - 当前 **Node 安装前缀**／`execPath`
  - 启动 Node 所必需的**有限**系统路径（如 `/usr`、`/System`、`/Library`、`/bin`、`/sbin`、`/dev`、`/private/var/db` 等——以「能跑通启动器＋探针」为上限）
- **禁止**把整个 `/var`、`/private/var`、`/var/folders`、`/private/var/folders`（及同类用户可写临时根）作为默认无差别可读放行
- **临时目录**：允许在工作根 `tmp/` **写**（`TMPDIR` 重定向到工作根）；**≠** 允许任意读 `/private/tmp`／`/tmp`，也 **≠** 允许读工作区外的 `os.tmpdir()`／`var/folders` 同级临时树。上述位置未列入放行表的答案副本 **默认不可读**
- **未列入放行表**的答案副本（不论是否在 `/Users`）**默认不可读**，不依赖逐条黑名单；完成口径＝收窄后的 allow-list，黑名单非唯一依据

### 关于黑名单（非默认完成依据）

若实现中保留「deny 原 `--skill-root`／`EVAL_EXTRA_DENY_READ`」作为辅助：

- **仅保障已登记／已传入的答案根**不可读
- **不得单独**作为「隔离已完成／评测通过」的依据
- A／C 验收以本页 **allow-list 受限可读** 的探针为准（须含**非 `/Users` 答案路径**，且该路径**不必**出现在 deny 列表中）

## 禁止当作「隔离已完成」的伪隔离

以下**不得单独**作为完成依据（C 已证伪）：

- 仅独立 cwd／清空 `NODE_PATH`
- 仅拒绝把 `hidden` 复制进暂存包（`stage_eval_agent_workspace` 只是准备步骤）
- 仅同属主 `chmod`／随后可改回
- 仅文档要求「请勿读取」
- **仅** deny 原 `skill-root`＋`(allow default)`
- **仅** `(allow file-read*)`＋deny `/Users`（`/private/tmp` 等同字节答案仍可读）

## 准备（评分者侧，隔离外）

在工作根（例：`/abs/work`）生成两棵树；评分树留在原 `$M/evals/hidden`（或另拷 `SCORE_TREE`），**不**挂进被测沙箱可读视图：

```sh
# 题目包 AGENT_WS（亦可由启动器自动 stage）
node scripts/stage_eval_agent_workspace.mjs --id E01 --out /abs/work/AGENT_WS

# 无答案 skill 副本（物理复制；无 symlink 指回 hidden）
node scripts/build_eval_skill_clean.mjs --out /abs/work/SKILL_CLEAN
```

`SKILL_CLEAN` **不含**：`evals/hidden/**`、`evals/scoring-rules*`、各场景 `case.yaml`、`fault.yaml`、`graders/`、`public-id-map.yaml`。

## 启动被测（默认唯一方式）

```sh
node scripts/run_eval_agent_isolated.mjs \
  --skill-root /abs/path/to/web-js-env-patcher \
  --work-root /abs/work \
  --scenario E01 \
  -- <被测命令...>
```

启动器将：

1. 校验／生成 `AGENT_WS`／`SKILL_CLEAN`：**题包**须 `scenarioId`＝本次 `--scenario` 且 **contentIdentity**（可见文件字节摘要）与当前场景源一致；**SKILL_CLEAN** 须 **contentIdentity** 与当前源 skill 可复制文件集一致（**含未提交改动**）。路径相同或 `git HEAD` 相同 **≠** 内容身份一致；不符则**销毁并重建**（禁止静默沿用旧树）  
2. 写入 Seatbelt：**deny-default allow-list**（无全局 `file-read*`；`TMPDIR`→工作根 `tmp/`；无整棵 `/var`／`var/folders` 读放行；`/private/tmp`／`/Users`／工作区外 `os.tmpdir()` 不在放行表）  
3. 在该沙箱内执行 `--` 后命令；**子进程继承同一限制**  
4. 注入环境变量：`EVAL_AGENT_WS`、`EVAL_SKILL_CLEAN`（探针可用 `EVAL_EXTERNAL_ANSWER_HINT`／`EVAL_PRIVATE_TMP_ANSWER_HINT`／`EVAL_SYSTEM_TMP_ANSWER_HINT`；**不必**把答案路径写入 deny 列表）

评分进程在隔离**外**持有 hidden／scoring-rules，读取被测产出后打分。

## 验收探针（须经本启动器）

| 读取目标 | 期望 |
| --- | --- |
| `AGENT_WS/` 题面与 workspace | 成功 |
| `SKILL_CLEAN/` 内合法 skill 文件 | 成功 |
| 原 `$M/evals/hidden/...`、scoring-rules | **失败** |
| 家目录下独立外部答案目录（**不必**登记进黑名单） | **失败** |
| **`/private/tmp`（或其它非 `/Users` 且未列入放行表）同字节答案** | **失败**（主进程） |
| **工作区外 `os.tmpdir()`／`var/folders`（及实路径）同字节答案** | **失败**（主／子／工作区 symlink；路径**不必**进 deny 列表） |
| 同上，**子进程**读 | **失败** |
| 工作区内 **symlink** 指向上述答案 | **失败** |
| 合法 Node／系统必要路径（如 `process.execPath`） | **仍可用** |

探针实现：`evals/lib/isolation-probe.mjs`（由 TEST 经 `run_eval_agent_isolated` 拉起）。
