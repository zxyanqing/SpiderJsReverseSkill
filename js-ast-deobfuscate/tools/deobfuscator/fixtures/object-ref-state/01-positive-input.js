function makeTable() {
  var row0 = [];
  var row1 = [];
  row0[0] = row0;
  row0[1] = row1;
  row1[0] = row0;
  row1[1] = row1;
  return [row0, row1];
}
var entry = makeTable()[0][1];
var other = makeTable()[1][0];
var sameAsEntry = makeTable()[0][1];
exportResult(entry, other, sameAsEntry);
