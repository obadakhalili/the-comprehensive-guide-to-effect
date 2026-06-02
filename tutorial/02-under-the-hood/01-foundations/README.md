# Section 2.1 — Foundations

Methods: `succeed`, `fail`, `sync`, `flatMap`, `map`, `tap`.

Part 1 ended on one claim: an Effect is not a running program, it's a description of one — a data
structure that a runtime walks. This part makes that literal. We build the description, and we build
the loop that walks it. Everything else in this tutorial is more node types and a bigger loop.

```bash
bun tutorial/02-under-the-hood/01-foundations/example.ts
```

## Why this exists: separate describing from doing

A normal function does its work the moment you call it. That's the problem. Once it has run, the work
is over — you can't retry it, time it, or look at it. It's gone.

So the first move is to stop *doing* and start *describing*. Instead of a function that runs, we make
a value that says what would run. Then a separate thing — the runtime — takes that value and carries
it out, later, when we ask. Describing and doing become two steps instead of one.

That's why the example prints nothing while it builds `program`, and only does work at
`runSyncExit`. Building stacks up a description. Running walks it.

## What an Effect actually is

Two halves, and it's worth keeping them apart.

The **public type** is opaque:

```ts
export interface Effect<out A, out E = never> { ... }
```

It carries two things: `A`, the value you get on success, and `E`, the way it can fail. That's all a
user sees. It's deliberately empty of detail so the types stay clean and inference works.

The **internal value** is a plain tagged object — a `Primitive`:

```ts
type Primitive =
  | { _op: "Succeed"; value: unknown }
  | { _op: "Failure"; error: unknown }
  | { _op: "Sync"; thunk: () => unknown }
  | { _op: "OnSuccess"; self: Effect<unknown, unknown>; f: (a) => Effect<unknown, unknown> }
```

Each constructor builds one of these objects and casts it to `Effect<A, E>`. The runtime casts back
and reads `_op`. So the same object is "an `Effect<number>`" to you and "a `{ _op: "Succeed" }`" to
the loop. That's the trade we picked: **the surface is fully typed, the core uses casts.** Real Effect
is built exactly this way — a typed API over an interpreter that works on loosely-typed nodes.

You can see the object in the example's step 2: `program` is just nested `_op` objects. No behavior,
just data.

## The constructors

`succeed`, `fail`, and `sync` are the leaves — they don't wrap other effects:

```ts
succeed(10)            // { _op: "Succeed", value: 10 }
fail("boom")           // { _op: "Failure", error: "boom" }
sync(() => Date.now()) // { _op: "Sync", thunk: () => Date.now() }
```

`succeed` and `fail` hold a value that's ready now. `sync` holds a *thunk* — a function the runtime
runs when it reaches that node. The difference matters: `succeed(Date.now())` captures the time when
you build the description; `sync(() => Date.now())` captures it when the description runs.

## flatMap: the one that needs a stack

`flatMap` is "run an effect, then use its result to build the next effect":

```ts
flatMap(succeed(10), (n) => succeed(n * 2))
```

It builds an `OnSuccess` node holding two things: `self` (the first effect) and `f` (what to do with
its value). Here's the catch the runtime has to deal with: to run `f`, it needs the value of `self`,
and `self` hasn't run yet. So `f` can't run now. It has to be set aside until `self` produces a value.

"Set aside" is a stack. When the loop hits an `OnSuccess`, it pushes `f` onto a stack and goes to run
`self` first:

```ts
case "OnSuccess":
  stack.push(node.f)        // postpone f
  current = toPrimitive(node.self) // run the child first
  continue
```

That's the only reason the stack exists: **to hold the `f` of a step whose input isn't ready yet.**

## map and tap are just flatMap

Neither is a primitive. Look at the runtime — there's no `Map` or `Tap` node. They're built from
`flatMap`:

```ts
map(self, f)  = flatMap(self, (a) => sync(() => f(a)))   // wrap the plain result back into an effect
tap(self, f)  = flatMap(self, (a) => map(f(a), () => a)) // run f(a), then ignore it and keep a
```

`map`'s `f` returns a plain value, so `map` wraps it in `sync(() => f(a))` to turn it back into an
effect the loop can run. `tap`'s `f` returns an effect that runs for its side effect; `map(..., () =>
a)` throws away that effect's result and keeps the original `a`. (This is exactly how the real library
defines them — `map` wraps with `sync`, `tap` keeps the original value.)

So the rule you'll use constantly:

```ts
map(self,     a => plainValue)  // your function returns a value
flatMap(self, a => anEffect)    // your function returns the next effect
tap(self,     a => anEffect)    // run an effect, keep the original value
```

## The runtime: three registers and a loop

`runSyncExit` is the whole engine. It holds:

- `current` — the node it's about to run.
- `value` / `failure` — the result of the last node (two registers).
- `inFailure` — which register is live: are we carrying a value, or an error?
- `stack` — the postponed `f`s.

And it loops over two halves: run a node, or pop a postponed step. Let's trace `program` from the
example: `succeed(10)`, doubled, plus one, with a tap. Watch `value` and `stack`:

```
start: current = OnSuccess(... three deep ...)        stack = []        value = —

  hit OnSuccess → push f3 (the tap), go run its child
  hit OnSuccess → push f2 (+1),      go run its child
  hit OnSuccess → push f1 (*2),      go run its child
                                                        stack = [f1,f2,f3]
  hit Succeed(10) → value = 10                          value = 10

  pop f1 → got a value → run f1(10) = succeed(20)       stack = [f2,f3]
  hit Succeed(20) → value = 20                          value = 20

  pop f2 → run f2(20) = sync(() => 21)                  stack = [f3]
  hit Sync → value = 21                                 value = 21

  pop f3 → run f3(21) = (the tap: log, then return 21)  stack = []
  ... tap logs "tap sees: 21", value stays 21           value = 21

  stack empty, current empty → done. Success 21.
```

The loop alternates the whole way: run a node, pop a step, run a node, pop a step. The stack fills up
as it dives into the chain, then drains as the value bubbles back through each postponed `f`.

## Failure is the same loop, one check different

Look at step 4 in the example: a failing program where the map after the failure never runs.

When the loop hits a `Failure` node, it writes the `failure` register and sets `inFailure = true`.
Now the unwinding half does one thing differently:

```ts
let frame = stack.pop()
while (frame) {
  if (!inFailure) { current = toPrimitive(frame(value)); break } // value → run the step
  frame = stack.pop()                                            // failure → discard the step
}
```

A value runs the next postponed step. A failure **discards** it and keeps popping. So once we're
failing, every postponed step on the happy path gets thrown away, one after another, until the stack
is empty and we finish as a `Failure`. That's why the `map` never ran — its `f` was a postponed step,
and the failure popped right past it.

This is `try/catch` rebuilt from a flag and a stack. There's nothing to catch the failure yet — that's
`catchAll`, in Section 2.4. For now a failure just unwinds everything.

## Where this maps in real Effect

The node names aren't made up. In the Effect source
(`repos/effect/packages/effect/src/internal/core.ts`), the primitive op-codes are `OP_SUCCESS`,
`OP_FAILURE`, `OP_SYNC`, and `OP_ON_SUCCESS` — our `Succeed`, `Failure`, `Sync`, and `OnSuccess`.
`map` there is literally `flatMap(self, a => sync(() => f(a)))`, the same definition we used. The real
runtime is a loop over these nodes with a stack of continuations, just with more node types and the
ability to pause — which is the next part.

One honest simplification: when our `Sync` thunk throws, we stuff the thrown thing into the `failure`
register. Real Effect treats an unexpected `throw` as a *defect* (a separate channel from typed
failures). We'll meet that distinction in Section 2.4. For now, a throw just fails.

Next: [`02-async/`](../02-async/) — how the loop pauses on a promise and picks back up, with no
`await` anywhere in your code.
