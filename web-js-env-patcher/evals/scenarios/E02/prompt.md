# 任务

本地需满足：写入 `sid=1; Path=/app` 后，在页面路径 `/other` 下读取 cookie 字符串时不应出现 `sid`；在 `/app` 或其子路径下应能看到 `sid`。另有 `ok=1; Path=/` 在 `/other` 下应可见。

**已观察：** 运行 `workspace/consumer.mjs` 后 `ok` 为 false。

请在正式路径下使 `node workspace/consumer.mjs` 得到 `ok: true` 且退出码 0。
