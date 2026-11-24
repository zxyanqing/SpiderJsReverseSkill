/**
 * C7 · 幂等性期望输出（const-propagate）
 *
 * 稳定形：引用已全部折叠。脚本会验证：
 *   transform(input) === expected
 *   transform(expected) === expected
 */
const token = 'abc';
const n = 2;
const request = {
  token: 'abc'
};
console.log(request, 2);
