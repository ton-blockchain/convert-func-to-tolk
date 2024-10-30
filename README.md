# Convert FunC contracts to Tolk with a single command

**Tolk** is a new language for writing smart contracts in TON. Think of Tolk as the "next‑generation FunC".
Tolk compiler is literally a fork of FunC compiler, introducing familiar syntax similar to TypeScript,
but leaving all low-level optimizations untouched.

Using just one-line command, you can take your existing FunC file and immediately transform it to Tolk:
```shell
npx @ton/convert-func-to-tolk jetton-minter.fc
```

Example input: [jetton-minter.fc](tests/inout/jetton-minter.fc)  
Example output: [jetton-minter.tolk](tests/inout/jetton-minter.fc.tolk)

Of course, the result will require some manual fixes, but definitely, almost all boilerplate is done automatically.


## Installation

Not required: just use `npx` above.


## Command-line options

`npx` above uses default options, but here is what you can pass:
* `--warnings-as-comments` — insert `/* _WARNING_ */` comments (not just print warnings to output)
* `--no-camel-case` — don't transform snake_case to camelCase  


## What exactly this converter does

* Converts `;; comment` → `// comment`
* Converts `#include` → `import`
* Removes deprecated `#pragma`
* Changes function syntax: `int f(slice a)` → `fun f(a: slice): int`
* Changes globals declarations: `global slice cs` → `global cs: slice`
* Changes variable declarations: `int a = 0` → `var a: int = 0`
* Changes complex variable declarations: `var (int a, slice b) = …` → `var (a: int, b: slice) = …`
* Removes `impure` specifiers (inserting `@pure` for asm functions)
* Replaces `inline` and `inline_ref` specifiers with `@` attributes 
* Converts `method_id` to get methods: `int seqno() method_id` → `get seqno(): int`
* Converts `forall` to generics syntax: `forall X -> X f()` → `fun f<X>(): X`
* Removes forward declarations, since Tolk locates symbols in advance, like most languages
* Wraps invalid identifiers into backticks: `op::increase` → `` `op::increase` ``
* Replaces `ifnot (x)` → `if (!x)` and similar
* Replaces `throw_unless(condition, excNo)` → `assert(excNo, condition)` and similar
* Replaces `null()` → `null`
* Replaces `null?(x)` → `x == null`
* Does all stdlib renaming: `begin_cell` → `beginCell`, `endParse` → `assertEndOfSlice`, etc.
* Converts `~` declarations: `(slice, int) ~load_op(slice s) { return s~load_uint(32); }` → `fun loadOp(mutate self: slice): int { return self.loadUint(32); }`
* Replaces `~method()` with `.method()`
* Replaces entrypoints: `recv_internal` → `onInternalMessage` and similar
* Converts functions and locals from snake_case to camelCase (globals/constants no, since a converter works per-file, whereas they are often imported)
* ... and lots of other stuff, actually

Of course, the convertion result can seem quite dirty. For instance, Tolk has logical operators, and therefore `if (~ found)` could probably be `if (!found)`. For instance, `flags & 1` could probably be `isMessageBounced(flags)`. For instance, `assert(!(a < 0))` is actually `assert(a >= 0)`. For instance, ``const `op::increase` `` would better be `const OP_INCREASE`. And so on.

Contracts written in Tolk from scratch would definitely look nicer. But that's what exactly expected from auto-conversion.


## Typical problems in Tolk code after conversion

Almost all problems are related to mutable methods. If FunC had `~methods` and `.methods`, Tolk has only `.methods`, which may mutate, or may not, the first `self` parameter. Hence, if a method was called in a strange way in FunC, it becomes an incorrect call in Tolk:
```
// FunC
int r = n~divmod(10);
// auto-converted, incorrect now
var r: int = n.divMod(10);
```

Obviously, this line should be rewritten:
```
var (newN, r) = divMod(n, 10);
// use newN or assign n = newN
// alternatively, use `redef` keyword:
var (n redef, r) = divMod(n, 10);
```

Lots of stdlib functions became mutating. This way, `cs~load_int(32)` replaced by `cs.loadInt(32)` works equally, but `cs.skip_bits(8)` (with dot! not tilda) replaced by `cs.skipBits(8)` works **differently**, because `skipBits()` mutates an object. 

Hence, if you used dot-call for `.methods` which become mutating, that part should be rewritten (it either won't compile or would work differently). Most common cases are `skip`-functions and `dict`-functions. Dict API in Tolk is mutating. If you used `dict~udict_set(…)`, it was replaced by `dict.uDictSet(…)`, and everything is fine. But if you used `dict.udict_set(…)` to obtain a copy, it's a problem.

The converter prints warnings in such cases. Some are falsy, but most are related to this exact problem.

Besides mutability, some stdlib functions were removed. For instance, `pair(a,b)` removed, as it can be replaced with `[a,b]`. As well as various functions working with tuples, which are supposed to be expressed syntactically.

Statistically, mutability covers about 90% of manual post-fixes, removed functions about 5%, and the rest 5% are minors.

Remember, that contracts written in Tolk from scratch would definitely look nicer than being auto-converted. For instance, using logical operators instead of bitwise tremendously increases code readability.
