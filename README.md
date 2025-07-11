# Convert FunC contracts to Tolk with a single command

**Tolk** is a next-generation language for smart contracts in TON.
It replaces FunC with modern syntax, strong types, and built-in serialization — while generating even more efficient assembler code.

Using single command, you can transform an exising FunC project to Tolk:
```shell
// all .fc files in a folder
npx @ton/convert-func-to-tolk contracts

// or a single file
npx @ton/convert-func-to-tolk jetton-minter.fc
```

Example input: [jetton-minter.fc](tests/inout/jetton-minter.fc)  
Example output: [jetton-minter.tolk](tests/inout/jetton-minter.fc.tolk)


## Converter: a starting point for migrating from FunC

This is a syntax-level converter that helps migrate FunC contracts to Tolk. It rewrites your code with 1:1 semantics — so you get a Tolk version of your contract that "looks and smells" like FunC.

The converted contract won't use modern Tolk features like `struct`, auto-serialization, or clean message composition. But after some manual fixes, it compiles, runs, and passes tests.

From there, you can gradually modernize the code — step by step, while keeping it functional at every stage.


## Installation

Not required: just use `npx` above.


#### Command-line options

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
* Wraps invalid identifiers into backticks: `op:increase` → `` `op:increase` ``
* Replaces `ifnot (x)` → `if (!x)` and similar
* Replaces `throw_unless(condition, excNo)` → `assert(excNo, condition)` and similar
* Replaces `null()` → `null`
* Replaces `null?(x)` → `x == null`
* Does all stdlib renaming: `begin_cell` → `beginCell`, `end_parse` → `assertEnd`, etc.
* Converts `~` declarations: `(slice, int) ~load_op(slice s) { return s~load_uint(32); }` → `fun slice.loadOp(mutate self): int { return self.loadUint(32); }`
* Replaces `~method()` with `.method()`
* Replaces entrypoints: `recv_internal` → `onInternalMessage` and similar
* Replaces string postfixes: `"str"c` → `stringCrc32("str")` and others
* Tries to guess when you need `address` instead of `slice`
* Converts functions and locals from snake_case to camelCase (globals/constants no, since a converter works per-file, whereas they are often imported)
* ... and lots of other stuff, actually

Of course, the convertion result seems quite dirty. For instance, Tolk has logical operators, and therefore `if (~ found)` could probably be `if (!found)`. For instance, `assert(!(a < 0))` is actually `assert(a >= 0)`. And so on.

Contracts written in modern Tolk from scratch look much nicer. But that's what exactly expected from auto-conversion.

Helpful link: [Tolk vs FunC: in short](https://docs.ton.org/v3/documentation/smart-contracts/tolk/tolk-vs-func/in-short).


## Typical problems in Tolk code after conversion

Almost all problems are **related to methods**. For two reasons:
1. FunC has `~methods` and `.methods`, Tolk has only `.methods`, which may mutate, or may not, the first `self` parameter. 
2. FunC allows any function `f(x)` to be called as a method `x.f()`, Tolk does not: functions and methods are different, like in other languages.

### Mutating methods

If a method was called strangely in FunC, it becomes an incorrect call in Tolk:
```
// FunC
int r = n~divmod(10);
// auto-converted, incorrect now
var r: int = n.divMod(10);
```

This line should be rewritten:
```
var (newN, r) = divMod(n, 10);
// use newN or assign n = newN
// alternatively, use `redef` keyword:
var (n redef, r) = divMod(n, 10);
```

Lots of stdlib functions became mutating. This way, `cs~load_int(32)` replaced by `cs.loadInt(32)` works equally, but `cs.skip_bits(8)` (with dot! not tilda) replaced by `cs.skipBits(8)` works **differently**, because `skipBits()` mutates an object. 

Hence, if you used dot-call for `.methods` which become mutating, that part should be rewritten (it either won't compile or would work differently). Most common cases are `skip`-functions and `dict`-functions. Dict API in Tolk is mutating. If you used `dict~udict_set(…)`, it was replaced by `dict.uDictSet(…)`, and everything is fine. But if you used `dict.udict_set(…)` to get a copy, it's a problem.

The converter prints warnings in such cases. Some are falsy, but most are related to this exact problem.

Deep dive: [Tolk vs FunC: mutability](https://docs.ton.org/v3/documentation/smart-contracts/tolk/tolk-vs-func/mutability).

### Functions are not allowed to be called as methods

If you had a function in FunC
```
builder store_msg_flags_and_address_none(builder b, int msg_flags) inline {
    return b.store_uint(msg_flags, 6);
}

// and somewhere
begin_cell()
  .store_msg_flags_and_address_none(BOUNCEABLE)
  ...
```

This will be auto-converted but won't compile:
```
@inline
fun storeMsgFlagsAndAddressNone(b: builder, msgFlags: int): builder {
    return b.storeUint(msgFlags, 6);
}

// and somewhere
beginCell()
  .storeMsgFlagsAndAddressNone(NON_BOUNCEABLE)   // won't compile
  ...
```

It won't compile with a message:
```
error: method `storeMsgFlagsAndAddressNone` not found for type `builder`
```

In FunC, `cell_hash(c)` and `c.cell_hash()` were equivalent. This is a reason why `cell_hash` and `slice_hash` are different functions.

In Tolk, functions and methods are different. `cell.hash()` and `slice.hash()` are now different methods (not global functions). Stdlib contains short names: you call `tupleVar.size()` instead of `tupleVar.tupleSize()`, and so on.

Hence, you should transform `storeMsgFlagsAndAddressNone` into a method for `builder`. Since it modifies a builder, it's a mutating method. Since it's chainable, it returns `self`:
```
@inline
fun builder.storeMsgFlagsAndAddressNone(mutate self, msgFlags: int): self {
    return self.storeUint(msgFlags, 6);
}
```

### Problems besides methods and mutability

* Some stdlib functions were removed. For instance, `pair(a,b)` removed, as it can be replaced with `[a,b]`. As well as various functions working with tuples, which are supposed to be expressed syntactically.

* Tolk is null-safe, so you can't assign `null` to `cell`, only to `cell?`. And since some stdlib functions return nullable values, types will most likely mismatch.

* Tolk has `bool` type (FunC had only `int`). Comparison operators `== != < >` return bool. Logical operators `&& ||` return bool. In FunC, you have to write `if (~ equal)`. In Tolk, bitwise `~` for bool is an error, write just `if (!equal)`. You can't assign `bool` to `int` directly, only via `boolVar as int` (but most likely, it's a bad idea). Remember, that `true` is -1, not 1.

* Tolk has `address` type (FunC had only `slice`). You can't assign `slice` to `address` and vice versa without `as` operator. The converter tries to guess whether `address` should be used instead. For instance `slice sender_address = ...` will be converted to `var senderAddress: address = ...`. 

Deep dive: [Tolk vs FunC: in detail](https://docs.ton.org/v3/documentation/smart-contracts/tolk/tolk-vs-func/in-detail).


## What should I do after successful convertion?

This converter gives you a working starting point — a Tolk contract that's still written in a "FunC style," but ready to be modernized step by step.

1. Once you fix compilation errors, you'll have a functional contract with the same logic as before — just in Tolk syntax. It won't use structs, auto-serialization, and other features yet.
2. From there, begin gradually refactoring the code:
   - Replace `onInternalMessage(inMsgFull: cell, inMsgBody: slice)` with `onInternalMessage(in: InMessage)` and use its fields directly
   - To handle bounces, use `onBouncedMessage(in: InMessageBounced)` — it's called automatically
   - Extract a `Storage` struct, with toCell/fromCell like in examples, use it everywhere instead of manual functions
   - Refactor incoming messages into structs with 32-bit opcodes — incrementally, one message at a time
   - Define a union of possible messages, use `val msg = lazy MyUnion.fromSlice(in.body)` and `match (msg)`
   - Extract outgoing messages into structs, and send them with `createMessage(...)`

The key idea: **your tests keep running at every stage**. That's what makes this approach safe — you can confidently refactor and modernize the codebase without breaking anything.

Deep dive: [Auto-packing to/from cells](https://docs.ton.org/v3/documentation/smart-contracts/tolk/tolk-vs-func/pack-to-from-cells).

Deep dive: [Universal createMessage](https://docs.ton.org/v3/documentation/smart-contracts/tolk/tolk-vs-func/create-message).


## Where can I find some "reference" contracts in Tolk?

Here: [Tolk vs FunC benchmarks](https://github.com/ton-blockchain/tolk-bench). This repository contains several contracts migrated from FunC — preserving original logic and passing the same tests.

If you are familiar with how jettons or NFTs are implemented in FunC, you'll feel right at home. The Tolk versions are significantly clearer and more readable. 
You can also explore the Git history to see how each contract was gradually rewritten, step by step.
