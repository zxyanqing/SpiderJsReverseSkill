# Wasm、Worker 与消息

什么时候读本文件：目标路径使用 Worker、Wasm 或 postMessage，需要核对生命周期与消息边界时。

## Wasm

目标路径使用 Wasm 时，记录模块资源/版本、初始化输入、导入对象、内存状态及输出消费点。Wasm 内部算法和浏览器环境依赖可分别定位，避免把加载失败自动归为 WebAPI 缺失。

## Worker

Worker 有独立全局、构造器、事件队列和生命周期。目标实际使用 Worker 时，观察 `self/globalThis`、`navigator`、`performance`、timer、消息及终止后的状态；Window-only API 的可见性按目标浏览器观察。扩展反射覆盖按实际消费决定；已实现桥接的公开接口、函数/异常所属 Realm 及父子上下文是否互相污染，作为相关改动的基本自检。

## 消息与克隆

`postMessage`、MessagePort、transfer 与 structuredClone 的顺序及错误行为可能影响结果。以浏览器事件时间线和本地目标路径比较；同名 API 存在不代表其异步语义正确。未触发的类别记录不适用或未知，不列入统一首轮实现范围。

## 异步边界

线程启动、消息到达、消息回调完成和产物消费是不同事件。将当前产物依赖的异步完成接入执行器；用没有无关定时器的任务检查回调是否仍可交付。等待全部后台任务或固定延长时长都不能代替实际边界。清理先后、超时状态与消息类型按 `references/integration-self-check.md` 检查。对象形状与跨 Realm 见 `references/env-object-model.md`。
