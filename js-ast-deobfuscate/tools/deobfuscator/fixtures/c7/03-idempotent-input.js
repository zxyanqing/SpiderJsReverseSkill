/**
 * C7 · 幂等性输入（const-propagate）
 *
 * 目的：第一次改写后，再跑同一插件应得到相同源码（不再继续变化）。
 * 本文件与正例同形，便于单独回归「第二次运行是否稳定」。
 */
const token = 'abc';
const n = 2;
const request = { token };
console.log(request, n);
