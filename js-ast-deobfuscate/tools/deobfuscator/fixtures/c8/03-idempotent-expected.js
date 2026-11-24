/** C8 幂等期望：第二轮没有候选可改写。 */
function sample() {
  const output = [];
  const order = [1, 0];
  let cursor = 0;
  output.push('stable');
  return output.join('-');
}
