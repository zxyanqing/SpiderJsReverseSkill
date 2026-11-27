# 任务

目标入口 `runAndReport()` 应对异步作业给出完成信号。消费方要求：当 `done === true` 时，`result` 已可用且 `result.value === 42`。

**已观察：** 运行 `workspace/consumer.mjs` 后 `ok` 为 false。

请在正式路径下使 `node workspace/consumer.mjs` 得到 `ok: true` 且退出码 0。
