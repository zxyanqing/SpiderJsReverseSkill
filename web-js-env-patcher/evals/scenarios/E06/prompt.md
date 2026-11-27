# 任务

存在基线函数 `compute()` 与可选包装入口。正式路径消费方要求：无包装时结果为 `7`；经包装后调用结果仍须为 `7`（与无包装基线一致）。

**已观察：** 运行 `workspace/consumer.mjs` 后 `ok` 为 false。

请在正式路径下使 `node workspace/consumer.mjs` 得到 `ok: true` 且退出码 0。
