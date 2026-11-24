/** normalize-structure 负例：作为实参的序列不拆 */
function sample(fn) {
  return fn((1, 2, 3));
}
