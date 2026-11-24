/** C8 幂等输入：一轮还原后不再含匹配的 while 分发器。 */
function sample() {
  const output = [];
  const order = [1, 0];
  let cursor = 0;
  while (true) {
    switch (order[cursor++]) {
      case 0:
        return output.join('-');
      case 1:
        output.push('stable');
        continue;
    }
    break;
  }
}
