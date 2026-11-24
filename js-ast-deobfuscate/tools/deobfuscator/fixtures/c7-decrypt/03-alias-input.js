/** C7 decrypt · 别名包装一层 */
var codes = [65, 66];
function dec(i) {
  return String.fromCharCode(codes[i]);
}
var wrap = dec;
function sample() {
  return wrap(0) + wrap(1);
}
