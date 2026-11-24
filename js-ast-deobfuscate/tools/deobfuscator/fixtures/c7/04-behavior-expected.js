/**
 * C7 · 行为对照期望输出（const-propagate）
 *
 * 源码级：index / label / flag 引用已折叠；offset + index 中的引用也已折叠。
 * 行为级：sample() 仍应返回 ["ok", true, 10, 20]。
 */
function sample() {
  const offset = 10;
  const index = 10;
  const label = 'ok';
  const flag = true;
  return ['ok', true, 10, 10 + 10];
}
