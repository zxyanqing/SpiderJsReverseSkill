/**
 * C7 · 正例输入（const-propagate）
 *
 * 目的：证明插件在「安全条件全部满足」时会发生预期替换。
 * 预期命中：
 *   - const token / const n 的读取引用被换成字面量
 *   - 对象简写 { token } 变成 { token: 'abc' }
 * 不应误伤：声明本身保留（删除声明交给 unused-binding）
 */
const token = 'abc';
const n = 2;
const request = { token };
console.log(request, n);
