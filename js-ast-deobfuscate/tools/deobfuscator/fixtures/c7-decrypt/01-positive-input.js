/** C7 decrypt · 正例：数字数组 + 解码函数 + 常量调用 */
var codes = [116, 111, 107];
function a0(i) {
  return String.fromCharCode(codes[i]);
}
function sample() {
  return a0(0) + a0(1) + a0(2);
}
