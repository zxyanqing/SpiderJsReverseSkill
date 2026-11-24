/** C8 反例期望：动态order order-not-static-array */
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
