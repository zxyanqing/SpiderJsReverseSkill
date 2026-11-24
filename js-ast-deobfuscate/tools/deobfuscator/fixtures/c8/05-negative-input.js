/** C8 反例： 动态order 不还原*/
function sample() {
  const order = getOrder();
  let cursor = 0;
  while (true) {
    switch (order[cursor++]) {
      case '0':
        console.log(token);
        continue;
    }
    break;
  }
}
