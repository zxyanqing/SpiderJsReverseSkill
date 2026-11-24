/** C8 行为输入：重复 case 后抛错，验证顺序、重复执行和异常完成。 */
function sample() {
  const trace = [];
  const order = ['a', 'a', 'stop'];
  let cursor = 0;
  while (true) {
    switch (order[cursor++]) {
      case 'a':
        trace.push('step');
        continue;
      case 'stop':
        throw new Error(trace.join('|'));
    }
    break;
  }
}
