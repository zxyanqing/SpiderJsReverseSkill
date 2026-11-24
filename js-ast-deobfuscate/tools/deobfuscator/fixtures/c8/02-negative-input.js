/** C8 反例：case 内有 const 声明，移动后可能改变 case 共享作用域与 TDZ。 */
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
