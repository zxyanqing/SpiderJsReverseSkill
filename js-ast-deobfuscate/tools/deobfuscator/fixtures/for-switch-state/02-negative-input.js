function run(flag) {
  var state = 1;
  for (; state !== 0;) {
    switch (state) {
      case 1:
        if (flag) {
          state = 2;
        } else {
          state = 0;
        }
        break;
      case 2:
        return 1;
    }
  }
}
