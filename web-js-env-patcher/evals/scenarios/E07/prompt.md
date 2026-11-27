# 任务

存在主／子两套带 `navigator` 的上下文。按「子」读取时，返回对象的 `realmId` 须为子侧标识，且 `platform` 为子侧值；按「主」读取时须对应主侧。

**已观察：** 运行 `workspace/consumer.mjs` 后 `ok` 为 false。

请在正式路径下使 `node workspace/consumer.mjs` 得到 `ok: true` 且退出码 0。
