import { initFunCParserOnce } from "../src/parse-func-source";
import { convertFunCToTolk } from "../src/convert-to-tolk";

beforeAll(async () => {
  await initFunCParserOnce(__dirname + '/../node_modules/web-tree-sitter/tree-sitter.wasm', __dirname + '/../tree-sitter-func/tree-sitter-func.wasm');
})

it('should convert comments', () => {
  const funCSource = `
{- this is
          multiline comment -}
#include "stdlib.fc";      ;; to be used
;; simple comment
;;; doc comment ;;
`
  const tolkSource = `
/* this is
          multiline comment */
      // to be used
// simple comment
/// doc comment ;;
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should preserve comments in strange places', () => {
  const funCSource = `
(
    int,    ;; available tokens
    int,    {- available seconds -}
    int     ;; time now, last received
) f(;;declaration
  int x, ;; first
  int y  ;; second
) {- just 0 -} { return 0; }
builder {- this is deleted -} store_uint_as_dec_string (builder b, int x) impure asm ""
  "ZERO"                                                        ;; b x i=0
  "SWAP" "TRUE"                                                 ;; b i=0 x f=-1
;
const {-b-} a = 1   {-+2-} +3;
global int {-b-} a {-b-}, {-b-} slice c;
int main() {
  int ({-a-} b {-c-}) = 10;
  if (true {-false-} + 1 {-2-}) { }
}
`
  const tolkSource = `
fun f(//declaration
  x: int, // first
  y: int  // second
): (
    int,    // available tokens
    int,    /* available seconds */
    int     // time now, last received
) /* just 0 */ { return 0; }
fun storeUintAsDecString(b: builder, x: int): builder
    asm ""
  "ZERO"                                                        // b x i=0
  "SWAP" "TRUE"                                                 // b i=0 x f=-1
;
const /*b*/ a = 1   /*+2*/ +3
global a: int /*b*/
global /*b*/ c: slice
fun main(): int {
  var (/*a*/ b: int /*c*/) = 10;
  if (true /*false*/ + 1 /*2*/) { }
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should remove impure specifier', () => {
  const funCSource = `
int main() impure   { return 0; }

(int) smb((cont) cs)impure inline_ref{var x = 10;}
    ()   a()  impure    method_id(0x12f) { var x = 20; }
{--}() as_is() { }
`
  const tolkSource = `
fun main(): int   { return 0; }

@inline_ref
fun smb(cs: continuation): int{var x = 10;}
    @method_id(0x12f)
fun a() { var x = 20; }
/**/fun asIs() { }
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should insert @pure annotation for asm', () => {
  const funCSource = `
() do1(int a) impure asm "NOP";
() do2(int b) inline_ref asm "NOP";
int get10() asm "10 PUSHINT" "20 PUSHINT" "DROP";
() terminate_unless(int) impure asm "IFNOTRETALT";
() terminate_if(int) asm "IFRETALT";
`
  const tolkSource = `
fun do1(a: int): void
    asm "NOP";
@inline_ref
@pure
fun do2(b: int): void
    asm "NOP";
@pure
fun get10(): int
    asm "10 PUSHINT" "20 PUSHINT" "DROP";
fun terminateUnless(_: int): void
    asm "IFNOTRETALT";
@pure
fun terminateIf(_: int): void
    asm "IFRETALT";
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should leave inline_ref', () => {
  const funCSource = `
_ check_message_destination(msg, var allowed_destinations) inline_ref {
  var cs = msg.begin_parse();
  var flags = cs~load_uint(4);
  if (flags & 8) {
  }
}
`
  const tolkSource = `
@inline_ref
fun checkMessageDestination(msg: todo, allowedDestinations: todo) {
  var cs = msg.beginParse();
  var flags = cs.loadUint(4);
  if (flags & 8) {
  }
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should convert #include to import', () => {
  const funCSource = `
#include "adsf"; ;; hello
#include "may/be/../about";
#include "some1.fc";
#include "some/2.func";
`
  const tolkSource = `
import "adsf" // hello
import "may/be/../about"
import "some1"
import "some/2"
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should remove deprecated pragmas', () => {
  const funCSource = `;; do

#pragma allow-post-modification;
#pragma compute-asm-ltr;
#pragma version >=0.5;
#pragma version >=1;

int main() { }
`
  const tolkSource = `// do

tolk 1.0


fun main(): int { }
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should convert multiple constant declarations', () => {
  const funCSource = `
const int one = 1;
const slice two_s = "asdf";
const int three = 3, four = 4 + (0 - 0);
const five = four + 1, six_s = "my";
`
  const tolkSource = `
const one = 1
const two_s = "asdf"
const three = 3
const four = 4 + (0 - 0)
const five = four + 1
const six_s = "my"
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})


it('should convert multiple global declarations', () => {
  const funCSource = `
global int one;             ;; asdf
global slice two_s;
global int three, four;
global five, cell six_s;
global var asdf;
`
  const tolkSource = `
global one: int             // asdf
global two_s: slice
global three: int
global four
global five
global six_s: cell
global asdf: todo
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should leave forall and asm', () => {
  const funCSource = `
forall X -> tuple tpush(tuple t, X value) impure asm "TPUSH";
forall X -> [X] single(X x) impure asm "SINGLE";
forall X -> X unsingle([X] one_tup) impure asm "UNSINGLE";
forall X,Y-> [X,Y] pair(X x, Y y) impure asm "PAIR";
() nothing() impure asm "NOP";
`
  const tolkSource = `
fun tpush<X>(t: tuple, value: X): tuple
    asm "TPUSH";
fun single<X>(x: X): [X]
    asm "SINGLE";
fun unsingle<X>(oneTup: [X]): X
    asm "UNSINGLE";
fun pair<X, Y>(x: X, y: Y): [X,Y]
    asm "PAIR";
fun nothing(): void
    asm "NOP";
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should drop forward declarations', () => {
  const funCSource = `
int value();
int value() { return 0; }
() fwd();  // also dropped
`
  const tolkSource = `
fun value(): int { return 0; }
  // also dropped
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should convert method_id to get', () => {
  const funCSource = `
int value() method_id { return 0; }
slice some_thing() method_id { }
int processed?() method_id { }
int some:other() method_id(123) { }
`
  const tolkSource = `
get fun value(): int { return 0; }
get fun some_thing(): slice { }
get fun \`processed?\`(): int { }
@method_id(123)
fun \`some:other\`(): int { }
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it ('should deal with arguments without types', () => {
  const funCSource = `
int value(a, b, [_,_] c) impure { return 0; }
`
  const tolkSource = `
fun value(a: todo, b: todo, c: [todo,todo]): int { return 0; }
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings.length).toBe(0)    // currently, no warnings emitted
  expect(result.tolkSource).toEqual(tolkSource)
})

it ('should deal with arguments without names', () => {
  const funCSource = `
int value(_, _ _, slice _, int _, asdf, slice) impure { return 0; }
`
  const tolkSource = `
fun value(_: todo, _: todo, _: slice, _: int, asdf: todo, _: slice): int { return 0; }
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings.length).toBe(0)
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should convert stdlib names in declaration and calls', () => {
  const funCSource = `;; my contract
#include "utils.fc";
#pragma version >=0.4.4;

int main() {
  fake_std_fn();
  var c = 1 + ~fake_std_fn();
  if (1) { do { } until (~ obj~fake_std_fn()); }
  display~udict::delete_get_min();
  send_raw_message(msg);
  var t = get_balance();
  return get_balance().pair_first() + pair_first(get_balance());
}
`
  const tolkSource = `// my contract
tolk 1.0

import "@stdlib/tvm-dicts"
import "utils"

fun main(): int {
  FAKE_STD_FN();
  var c = 1 + ~FAKE_STD_FN();
  if (1) { do { } while (!(~ obj.FAKE_STD_FN())); }
  display.uDictDeleteFirstAndGet();
  sendRawMessage(msg);
  var t = contract.getOriginalBalanceWithExtraCurrencies();
  return contract.getOriginalBalance() + contract.getOriginalBalance();
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should surround prohibited symbols in names in declaration and calls', () => {
  const funCSource = `
int op:rwallet:op() asm "0x82eaf9c4 PUSHINT";
global int c:d;
const off:set = 1, my:comp=off:set + 2;
const int \`op::fill_up\` = 0x370fec51;
int main(int should?, slice msg:body) {
  op:rwallet:op();
  var c = 1 + ~op:rwallet:op() + c:d + my:comp;
  if (1) { do { } until (~ obj~op:rwallet:op()); }
  var found? = search();
}
`
  const tolkSource = `
@pure
fun \`op:rwallet:op\`(): int
    asm "0x82eaf9c4 PUSHINT";
global \`c:d\`: int
const \`off:set\` = 1
const \`my:comp\` = \`off:set\` + 2
const \`op::fill_up\` = 0x370fec51
fun main(isShould: int, \`msg:body\`: slice): int {
  \`op:rwallet:op\`();
  var c = 1 + ~\`op:rwallet:op\`() + \`c:d\` + \`my:comp\`;
  if (1) { do { } while (!(~ obj.\`op:rwallet:op\`())); }
  var isFound = search();
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should convert statement variable declarations', () => {
  const funCSource = `
() main() {
  var unchanged = cs;
  int i = 0;
  [int] (i2) = 0;
  var (val, b) = (1,2);
  (int) (a2, [b2]) = nil;
  var (int i3, [cont] s3) = (1, "asdf");
  slice (a5, b5) = ("a", "b");
  cell (a4, (self, (c4))) = nil;
  return ();
}`
  const tolkSource = `
fun main() {
  var unchanged = cs;
  var i: int = 0;
  var (i2: [int]) = 0;
  var (vall, b) = (1,2);
  var (a2: (int), [b2: (int)]) = null;
  var (i3: int, s3: [continuation]) = (1, "asdf");
  var (a5: slice, b5: slice) = ("a", "b");
  var (a4: cell, (selff: cell, (c4: cell))) = null;
  return;
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should convert expression variable declarations', () => {
  const funCSource = `
() main() {
  (int i) = 0;
  (int i2, slice cs2) = (0, cs);
  [slice s3, (int) _] = nil;
  (int i4, var c4, var b4) = nil;
  (_, _, int i5) = (0,0,0);
  (int a, (int b, slice c)) = f();
}`
  const tolkSource = `
fun main() {
  var (i: int) = 0;
  var (i2: int, cs2: slice) = (0, cs);
  var [s3: slice, _: (int)] = null;
  var (i4: int, c4: todo, b4: todo) = null;
  var (_, _, i5: int) = (0,0,0);
  var (a: int, (b: int, c: slice)) = f();
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should deal with mixing variables declarations and assign to existing', () => {
  const funCSource = `
() main() {
  int old_var = 0;
  (int one, old_var) = (1, 1);
  (cs, int mask, [d]) = cs.load_custom_uint(32);
}`
  const tolkSource = `
fun main() {
  var oldVar: int = 0;
  var (one: int, oldVar redef) = (1, 1);
  var (cs redef, mask: int, [d redef]) = cs.loadCustomUint(32);
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should add parenthesis to if, while, etc', () => {
  const funCSource = `
int main() {
  if x {-y-} { }
  elseif cs~load() { }
  if (x ) { }
  elseif (cs~load()) { }
  if (x) > 0 { }
  elseifnot (((cs~load()))) { }
  repeat (10) + 1 { }
  while a > 0 { }
}
`
  const tolkSource = `
fun main(): int {
  if (x) /*y*/ { }
  else if (cs.load()) { }
  if (x ) { }
  else if (cs.load()) { }
  if ((x) > 0) { }
  else if (!((cs.load()))) { }
  repeat ((10) + 1) { }
  while (a > 0) { }
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should convert ifnot(x) to if(!x)', () => {
  const funCSource = `
int main() {
  if (x) { }
  ifnot (x) { }
  ifnot (f()) { }
  elseif f() { }
  elseifnot (cs~load_uint(32)) { }
  else { }
  ifnot (~ found) { }
  ifnot (a + b) { }
  elseifnot c | (d == 1) { }
}
`
  const tolkSource = `
fun main(): int {
  if (x) { }
  if (!x) { }
  if (!f()) { }
  else if (f()) { }
  else if (!cs.loadUint(32)) { }
  else { }
  if (!(~ found)) { }
  if (!(a + b)) { }
  else if (!(c | (d == 1))) { }
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should convert do{}until(e) to do{}while(!e)', () => {
  const funCSource = `
int main() {
  do { } until (0) { }
  do { } until (expr) { }
  do { 
    do { } until ~ found { }
  } until (1 + 2) { }
}
`
  const tolkSource = `
fun main(): int {
  do { } while (!0) { }
  do { } while (!expr) { }
  do { 
    do { } while (!(~ found)) { }
  } while (!(1 + 2)) { }
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should convert null() to null, null?() to ==null', () => {
  const funCSource = `
int main() {
  tuple t = nil;
  var x = null();
  (f + f)(null() + x);
  if (null?(x)) { c = null?(x + y); }
  if (null?(x) & cell_null?(x) & ~ builder_null?(x)) { }
  while (~ null?(x)) { }
  do { } until (null?(null?(x)));
  var c = f1().f2().cell_null?();
  if (~ fwd_payload.null?()) { }
  var c = beginBalance(null()).cell_null?();
}
`
  const tolkSource = `
fun main(): int {
  var t: tuple = null;
  var x = null;
  (f + f)(null + x);
  if ((x == null)) { c = ((x + y) == null); }
  if ((x == null) & (x == null) & ~ (x == null)) { }
  while (~ (x == null)) { }
  do { } while (!((x == null) == null));
  var c = (f1().f2() == null);
  if (~ (fwd_payload == null)) { }
  c = (beginBalance(null) == null);
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should replace some mathematical tokens', () => {
  const funCSource = `
const asdf = 1 /% 2;
const asdf = x + 1 /% 2;
const asdf = 1 /% (2 /% 3);
int main() {
  return 2 ~/ 3;
  return null?(2 /% 3);
}
`
  const tolkSource = `
const asdf = divMod(1, 2)
const asdf = x + divMod(1, 2)
const asdf = divMod(1, (divMod(2, 3)))
fun main(): int {
  return 2 ~/ 3;
  return ((divMod(2, 3)) == null);
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should warn on removed mathematical tokens', () => {
  const funCSource = `
int main() {
  var a = 1;
  a ^%= 2;
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings.length).toBe(1)
  expect(result.warnings[0].text).toContain('operator ^%= has been removed')
})

it('should replace throw and similar', () => {
  const funCSource = `
() main(in_msg_body) {
  throw(44);
  throw (x | y);
  throw   x | y;
  throw_arg(arg, 44);
  throw_arg(arg,44,invalid);
  throw_if(44, x > 0);
  throw_unless(44, x > 0);
  throw_if(// throw if msg not "cancel"
          \`exit::not_cancel\`(),
          ~(equal_slices?(in_msg_body, \`msg::cancel_msg\`()))
  );
}
`
  const tolkSource = `
fun main(inMsgBody: todo) {
  throw 44;
  throw x | y;
  throw   x | y;
  throw (44, arg);
  throw (44, arg, invalid);
  assert(!(x > 0)) throw 44;
  assert(x > 0) throw 44;
  assert(!(~(isEqualSlices(inMsgBody, \`msg::cancel_msg\`())))) throw \`exit::not_cancel\`();
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should inverse catch arguments', () => {
  const funCSource = `
() main() {
  try { } catch (arg, exc_no) { }
  try { } catch (arg, _) { }
  try { } catch (_, code) { }
  try { } catch (_, _) { }
  try { } catch (single) { }
}
`
  const tolkSource = `
fun main() {
  try { } catch (exc_no, arg) { }
  try { } catch (_, arg) { }
  try { } catch (code) { }
  try { } catch { }
  try { } catch (single) { }
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should insert import @stdlib for specific functions', () => {
  const funCSource = `
() main() {
  dict~idict_set_ref();
  int empty_list = 0;
}
`
  const tolkSource = `import "@stdlib/tvm-dicts"

fun main() {
  dict.iDictSetRef();
  var emptyList: int = 0;
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should convert ~methods to mutate self and returns in it', () => {
  const funCSource = `
;; declared via ~
(slice, int) ~load_op(slice s) { return s~load_uint(32); }
(slice, int) ~load_query_id(slice s) { return s~load_uint(64); }
(slice, (int, int)) ~load_multi(slice s, int upto) { return (sNew, (1,2)); }
(slice, ()) ~load_nothing(slice s, int upto) { log(s); return (s, ()); }
(slice, (cell)) ~load_cell(slice s) { return (s.parse(), begin_cell()); }
(slice, int) ~load_op(slice ABC) { return (ABC, ABC~load_uint(32)); }
(slice, int) ~load_query_id(slice s) { if (1) { s.skip(); } return s~load_uint(64); }
(slice, (int, int)) ~load_multi(slice s, int upto) {}
(slice, ()) ~load_nothing(slice s, int upto) {}
;; heuristically detected
(slice, ()) skip_bounce_flag(slice s) impure inline {
    s~skip_bits(32); ;; 0xFFFFFFFF
    return (s, ());
}
(slice, (int, int, int)) load_fees(slice s) {
    var fees = (s~load_grams(), s~load_grams(), s~load_uint(14));
    return (s, fees);
}
(cell, ()) set_node(cell p, int i, int v) {
  p~udict_set_builder(node_dict_key_len, i, begin_cell().store_uint(v, 256));
  return (p, ());
}
(cell, (int, slice, int)) ~udict_delete_get_min?(cell dict, int key_len) asm(-> 0 2 1 3) "DICTUREMMIN" "NULLSWAPIFNOT2";
(slice, int) load_gas_prices(slice param) inline {
    var gas_price = param~load_uint(64);
    return (param, gas_price);
}
`
  const tolkSource = `import "@stdlib/tvm-dicts"

// declared via ~
fun slice.loadOp(mutate self): int { return self.loadUint(32); }
fun slice.loadQueryId(mutate self): int { return self.loadUint(64); }
fun slice.loadMulti(mutate self, upto: int): (int, int) { self = sNew; return (1,2); }
fun slice.loadNothing(mutate self, upto: int): void { log(self); return; }
fun slice.loadCell(mutate self): cell { self = self.parse(); return beginCell(); }
fun slice.loadOp(mutate self): int { return self.loadUint(32); }
fun slice.loadQueryId(mutate self): int { if (1) { self.skip(); } return self.loadUint(64); }
fun slice.loadMulti(mutate self, upto: int): (int, int) {}
fun slice.loadNothing(mutate self, upto: int): void {}
// heuristically detected
@inline
fun slice.skipBounceFlag(mutate self): void {
    self.skipBits(32); // 0xFFFFFFFF
    return;
}
fun slice.loadFees(mutate self): (int, int, int) {
    var fees = (self.loadCoins(), self.loadCoins(), self.loadUint(14));
    return fees;
}
fun cell.setNode(mutate self, i: int, v: int): void {
  self.uDictSetBuilder(node_dict_key_len, i, beginCell().storeUint(v, 256));
  return;
}
@pure
fun cell.isUdictDeleteGetMin(mutate self, keyLen: int): (int, slice, int)
    asm(-> 0 2 1 3) "DICTUREMMIN" "NULLSWAPIFNOT2";
@inline
fun slice.loadGasPrices(mutate self): int {
    var gasPrice = self.loadUint(64);
    return gasPrice;
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should replace ~call() with .call()', () => {
  const funCSource = `
() main() {
  cs~load_int(32);
  cell x = cs~load_maybe_ref();
  cs~load_custom();
  getCs()~load_bits();
  cs~store_uint(1, 32);
  dict~idict_add_builder?(b);
  f~touch();
  ~dump(-1);
  f~dump();
  var has_payload = ~ cell_null?(payload);
  { var has_payload = ~ (payload == null()); }
  return (cs, cs~load_int(cs~load_int(0)));
}
`
  const tolkSource = `import "@stdlib/tvm-dicts"
import "@stdlib/tvm-lowlevel"

fun main() {
  cs.loadInt(32);
  var x: cell = cs.loadMaybeRef();
  cs.loadCustom();
  getCs().loadBits();
  cs.storeUint(1, 32);
  dict.iDictSetBuilderIfNotExists(b);
  f.stackMoveToTop();
  ~debug.print(-1);
  f.debug.print();
  var hasPayload = ~ (payload == null);
  { var hasPayload = ~ (payload == null); }
  return (cs, cs.loadInt(cs.loadInt(0)));
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should warn on .load_int() etc. that it became modifying', () => {
  const funCSource = `
() main() {
  (cs, int new) = cs.load_int(32);
  (locked', ts, value_cs, f) = locked.udict_delete_get_min(32);
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings.length).toBe(2)
  expect(result.warnings[0].text).toContain('.loadInt() now mutates')
})

it('should convert entrypoint names', () => {
  const funCSource = `
_ main() { }
_ recv_internal(slice cs) { }
_ recv_external(slice in_msg) { }
_ run_ticktock(slice in_msg) { }
_ split_prepare(slice in_msg) { }
_ split_install(slice in_msg) { }
`
  const tolkSource = `
fun main() { }
// in the future, use: fun onInternalMessage(in: InMessage) {
fun onInternalMessage(cs: slice) { }
fun onExternalMessage(inMsg: slice) { }
fun onRunTickTock(inMsg: slice) { }
fun onSplitPrepare(inMsg: slice) { }
fun onSplitInstall(inMsg: slice) { }
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should replace restricted symbols in identifiers', () => {
  const funCSource = `
const op:call = 0;
const %a'&?$!b = 0;
global int 2x;
const \`3x()s\` = 0;
_ %'() { int op::call' = 0; var (locked', int a) = (); if op::call' { %''(); } }
`
  const tolkSource = `
const \`op:call\` = 0
const \`%a'&?$!b\` = 0
global \`2x\`: int
const \`3x()s\` = 0
fun \`%'\`() { var \`OP_CALL'\`: int = 0; var (\`locked'\`, a: int) = (); if (\`OP_CALL'\`) { \`%''\`(); } }
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should warn on calling deleted function', () => {
  const funCSource = `
_ main() {
  single(x);
  unsingle(x);
  get_something().pair_first();
  var tuple4 = [];
  return pair_first + 1;
}
`
  const tolkSource = `
fun main() {
  single(x);
  unsingle(x);
  getSomething().pair_first();
  var tuple4 = [];
  return pair_first + 1;
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings.length).toBe(3)
  expect(result.warnings[0].text).toContain('`single` has been removed')
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should insert redef in trivial cases', () => {
  const funCSource = `
_ f() {
  int a_a = 0;
  int a_a = 1;
  var (int a_a, slice b) = ();
  slice b = get();
  int kk = 0;
  if (1) {
    int a_a = 2;
    (int b, int c) = (0, 0);
    (int c, int d') = (0, 0);
    slice (d', kk) = get();
  }
}
`
  const tolkSource = `
fun f() {
  var aA: int = 0;
  aA = 1;
  var (aA redef, b: slice) = ();
  b = get();
  var kk: int = 0;
  if (1) {
    var aA: int = 2;
    var (b: int, c: int) = (0, 0);
    var (c redef, \`d'\`: int) = (0, 0);
    var (\`d'\` redef, kk: slice) = get();
  }
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should drop constants that are now in stdlib', () => {
  const funCSource = `
const WORKCHAIN = 0;
const int BOUNCEABLE = 0x18;
const NON_BOUNCEABLE = 0x10;

const SEND_MODE_REGULAR = 0;
const SEND_MODE_PAY_FEES_SEPARATELY = 1;
const SEND_MODE_IGNORE_ERRORS = 2;
const SEND_MODE_DESTROY = 32374283467;
const SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE = 64;
const SEND_MODE_CARRY_ALL_BALANCE = 128;
`
  const tolkSource = `
const WORKCHAIN = 0

const SEND_MODE_DESTROY = 32374283467

`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should convert snake_case to camelCase', () => {
  const funCSource = `
int get_amount_out(int amountIn, int reserveIn, int reserveOut) method_id { }
() after_code_upgrade(slice param, cont old_code) impure method_id(1666);

int main(slice in_msg_body, surround?) {
  (int init?, int index) = load_data();
  if (init? & surround?) {
    int found? = in_msg_body~load_int(32) == 1;
    throw_unless(444, found?);
  }
  int sum_values = 1 + get_amount_out();
  after_code_upgrade();
  begin_cell().store_uint(sum_values);
}
`
  const tolkSource = `
get fun get_amount_out(amountIn: int, reserveIn: int, reserveOut: int): int { }

fun main(inMsgBody: slice, isSurround: todo): int {
  var (isInit: int, index: int) = loadData();
  if (isInit & isSurround) {
    var isFound: int = inMsgBody.loadInt(32) == 1;
    assert(isFound) throw 444;
  }
  var sumValues: int = 1 + get_amount_out();
  after_code_upgrade();
  beginCell().storeUint(sumValues);
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should insert warnings as comments', () => {
  const funCSource = `
_ recv_internal(slice in_msg_body) {
  var (new, value) = in_msg_body.load_int(32);
  cs.skip_bits().load_uint(32);
  single();
}
`
  const tolkSource = `
// in the future, use: fun onInternalMessage(in: InMessage) {
fun onInternalMessage(inMsgBody: slice) {
  var (new, value) = inMsgBody/* _WARNING_ method .loadInt() now mutates the object and returns just int */.loadInt(32);
  cs/* _WARNING_ method .skipBits() now mutates the object and returns self */.skipBits()/* _WARNING_ method .loadUint() now mutates the object and returns just int */.loadUint(32);
  /* _WARNING_ function \`single\` has been removed */single();
}
`
  let result = convertFunCToTolk(funCSource, { shouldInsertWarningsAsComments: true })
  expect(result.warnings.length).toBe(4)
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should convert string postfixes', () => {
  const funCSource = `
const a = "s"c;
const a = "s"H;
const a = "s"h;
const a = "s"s;
const a = "s"u;
const a = "s"a;
`
  const tolkSource = `
const a = stringCrc32("s")
const a = stringSha256("s")
const a = stringSha256_32("s")
const a = stringHexToSlice("s")
const a = stringToBase256("s")
const a = address("s")
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})

it('should replace slice with address', () => {
  const funCSource = `
() save_data(slice sender) {
    slice cs = in_msg_full.begin_parse();
    slice sender_address = cs~load_msg_addr();
    set_data(begin_cell()
        .store_slice(admin_address).store_slice(cs)
    );
    if (~ is_address_none(get_ccc())) {}
    (int wc, _) = parse_std_addr(addr);
}
`
  const tolkSource = `
fun saveData(sender: address) {
    var cs: slice = in_msg_full.beginParse();
    var senderAddress: address = cs.loadAddress();
    contract.setData(beginCell()
        .storeAddress(admin_address).storeSlice(cs)
    );
    if (~ getCcc().isNone()) {}
    var (wc: int, _) = addr.getWorkchainAndHash();
}
`
  let result = convertFunCToTolk(funCSource)
  expect(result.warnings).toStrictEqual([])
  expect(result.tolkSource).toEqual(tolkSource)
})
