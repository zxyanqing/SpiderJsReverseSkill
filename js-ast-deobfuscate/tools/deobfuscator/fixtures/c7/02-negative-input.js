/**
 * C7 · 反例输入（const-propagate）
 *
 * 目的：证明插件在证据不足时不会误改写。
 * 必须保留的反例：
 *   1) let + 再赋值：绑定不恒定
 *   2) const 对象：基础字面量白名单之外（对象身份）
 *   3) 调用参与运算：副作用/结果未知
 */
let mutable = 1;
mutable = 2;
console.log(mutable);
const bag = { x: 1 };
console.log(bag);
const dyn = getValue() + 1;
console.log(dyn);
