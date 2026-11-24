/** C7 decrypt · 反例：动态实参不得替换 */
var codes = [116, 111, 107];
function a0(i) {
  return String.fromCharCode(codes[i]);
}
function sample(x) {
  return a0(x);
}
