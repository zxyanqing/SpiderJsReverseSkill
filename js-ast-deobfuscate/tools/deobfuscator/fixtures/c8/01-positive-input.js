/** C8 正例：静态顺序为 2 → 0 → 1，三个 case 均有明确终止。 */
function sample() {
  const result = [];
  const order = ['2', '0', '1'];
  let cursor = 0;
  while (true) {
    switch (order[cursor++]) {
      case '0':
        result.push('token');
        continue;
      case '1':
        return result.join(':');
      case '2':
        result.push('start');
        continue;
    }
    break;
  }
}
