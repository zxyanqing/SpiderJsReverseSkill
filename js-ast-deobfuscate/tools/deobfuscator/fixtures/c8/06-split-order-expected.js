/** C8 split 正例期望 */
function sample() {
  const result = [];
  const order = "2,0,1".split(",");
  let cursor = 0;
  result.push("start");
  result.push("token");
  return result.join(":");
}
