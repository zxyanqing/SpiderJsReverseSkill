/**
 * C7 · 反例期望输出（const-propagate）
 *
 * 语义必须与输入一致：不传播 let、不展开对象、不猜测 getValue()。
 * 仅允许 generator 带来的排版差异（例如对象字面量换行）。
 */
let mutable = 1;
mutable = 2;
console.log(mutable);
const bag = {
  x: 1
};
console.log(bag);
const dyn = getValue() + 1;
console.log(dyn);
