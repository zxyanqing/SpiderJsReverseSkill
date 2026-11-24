function makeTable() {
  var row0 = [];
  var row1 = [];
  row0[0] = row0;
  row0[1] = row1;
  row1[0] = row0;
  row1[1] = row1;
  return [row0, row1];
}
var entry = 1;
var other = 0;
var sameAsEntry = 1;
exportResult(entry, other, sameAsEntry);
