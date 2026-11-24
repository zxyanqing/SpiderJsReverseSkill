/** C8 正例期望：按 order 克隆语句，分发器 continue 被删除，return 被保留。 */
function sample() {
  const result = [];
  const order = ['2', '0', '1'];
  let cursor = 0;
  result.push('start');
  result.push('token');
  return result.join(':');
}
