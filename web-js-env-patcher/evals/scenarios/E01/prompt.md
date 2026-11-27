# 任务

已确定要在本地跑原始脚本。消费方检查 `navigator.platform` 的属性描述符，须满足：`writable: false`、`enumerable: true`、`configurable: true`，且值为字符串 `MacIntel`。

**已观察：** 运行 `workspace/consumer.mjs` 后进程退出非 0，输出 JSON 中 `ok` 为 false；属性可读到字符串值。

请在正式路径下使 `node workspace/consumer.mjs` 得到 `ok: true` 且退出码 0。
