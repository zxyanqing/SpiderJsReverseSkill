/** normalize-structure 正例：语句级序列 / 三元 / && */
function sample() {
  var a = 1;
  a = 1, a = 2, a = 3;
  a ? (a = 4) : (a = 5);
  a && (a = 6);
  return a;
}
