/** C8 反例期望：作用域风险导致失败关闭，原分发器完整保留。 */
function sample() {
  const order = ['0'];
  let cursor = 0;
  while (true) {
    switch (order[cursor++]) {
      case '0':
        const token = 'keep';
        console.log(token);
        continue;
    }
    break;
  }
}
