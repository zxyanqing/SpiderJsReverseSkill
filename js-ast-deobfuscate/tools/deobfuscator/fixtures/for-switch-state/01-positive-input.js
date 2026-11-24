function run() {
  var state = 1;
  for (; state !== 0;) {
    switch (state) {
      case 1:
        stepA();
        state = 2;
        break;
      case 2:
        return stepB();
    }
  }
}
