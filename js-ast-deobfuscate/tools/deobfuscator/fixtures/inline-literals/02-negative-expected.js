/** inline-literals 负例：再赋值不可传播 */
function sample() {
  var x = 1;
  x = 2;
  return x;
}
