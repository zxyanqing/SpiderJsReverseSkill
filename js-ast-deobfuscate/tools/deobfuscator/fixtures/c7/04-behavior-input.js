/**
 * C7 · 行为对照输入（const-propagate）
 *
 * 目的：改写前后「可观察返回值」一致（不只比源码文本）。
 * sample() 返回固定结构，供脚本在隔离 Function 中执行对照。
 */
function sample() {
  const offset = 10;
  const index = offset;
  const label = 'ok';
  const flag = true;
  return [label, flag, index, offset + index];
}
