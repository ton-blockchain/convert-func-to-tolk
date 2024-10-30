fun one(dummy: tuple) {
  return 1;
}

fun main(a: int, x: int) {
  var y: int = 0;
  var z: int = 0;
  while ((y = x * x) > a) {
    x -= 1;
    z = one(null);
  }
  return (y, z);
}
