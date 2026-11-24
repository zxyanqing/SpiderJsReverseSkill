function makeTable() {
  return [[1, 2], [3, 4]];
}
// 单元格是数字而非对象引用 → 应跳过，保持原样
var x = makeTable()[0][1];
