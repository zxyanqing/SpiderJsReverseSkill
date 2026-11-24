/** C8 行为期望：重复执行两次 step，再抛出同类型同消息错误。 */
function sample() {
  const trace = [];
  const order = ['a', 'a', 'stop'];
  let cursor = 0;
  trace.push('step');
  trace.push('step');
  throw new Error(trace.join('|'));
}
