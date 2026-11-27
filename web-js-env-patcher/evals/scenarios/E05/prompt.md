# 任务

加载器按所需 import 名列表解析提供方对象。消费方要求：缺少任一所需 import 时不得继续成功；所需 import 齐全时可报告加载成功。

**已观察：** 运行 `workspace/consumer.mjs` 后 `ok` 为 false。

请在正式路径下使 `node workspace/consumer.mjs` 得到 `ok: true` 且退出码 0。
