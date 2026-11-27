# 任务

用 fixture 对照本地输出。必填键为 `sign` 与 `ts`。工作区提供两份 fixture 与比较入口；消费方要求：不完整的 fixture 不得判为通过，完整 fixture 且字段一致时应通过。

**已观察：** 运行 `workspace/consumer.mjs` 后 `ok` 为 false。

请在正式路径下使 `node workspace/consumer.mjs` 得到 `ok: true` 且退出码 0。
