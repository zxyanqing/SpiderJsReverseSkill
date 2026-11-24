function outer() {
  var x = tableRef,
    arr = ['$_Decoy'].concat(x),
    a = arr[1];
  arr.shift();
  var b = arr[0];
  keepMe();
}
