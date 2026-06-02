# Section 2.6 — Ergonomics (pipe + dual)

New: `pipe` and `dual`.

This part adds **no runtime behavior**. Run the example and look at the two versions of the same
program — `nested` and `piped`. They produce the same result because they build the same node tree.
The only difference is how the source reads. This part is about making the API pleasant, and about
seeing clearly that pleasantness is a source-level thing that's gone by the time the runtime runs.

```bash
bun tutorial/02-under-the-hood/06-ergonomics/example.ts
```

## Why this exists: nested calls read inside-out

Look at `nested` in the example. To follow it, you read from the innermost call outward:
`flatMap` first, then `retry` around it, then `map`, then `tap`, then `timeout`, then `catchAll`, then
`provide`. The first thing that runs is buried deepest, and the last thing is on the outside. For a
chain of seven steps that's hard to read and hard to edit.

`pipe` flips it. The `piped` version lists the same seven steps top-to-bottom, in the order they run:

```ts
const piped = pipe(
  flatMap(service(Api), (api) => api.get("/user")),
  retry({ times: 5, while: (e) => e._tag === "Network" }),
  map((body) => body.toUpperCase()),
  tap((value) => sync(() => console.log("  fetched:", value))),
  timeout(1000),
  catchAll((e) => succeed(`recovered: ${JSON.stringify(e)}`)),
  provide(Api, ApiLive)
)
```

That reads like a description of what happens: fetch, retry, uppercase, log, time-limit, recover,
provide the dependency. Same tree, readable order.

## pipe is just function application

There's nothing clever in `pipe`. It takes a value and a list of functions and runs them left to
right:

```ts
function pipe(a, ...fns) {
  return fns.reduce((acc, fn) => fn(acc), a)
}
```

So `pipe(x, f, g, h)` is exactly `h(g(f(x)))`. The overloads above the implementation are only there
to thread the types through each step so inference works. There's no runtime concept here — `pipe`
runs while you *build* the effect, not while it runs. By the time `runPromise` sees the result, `pipe`
is gone; it already did its job of assembling the node tree.

## The problem dual solves

For `pipe(x, f, g)` to work, each step has to be a function that takes the value and returns the next
one. But `map(self, f)` takes *two* arguments — the effect and the function. You can't drop it into a
pipe; pipe only hands it one thing (the effect).

So we need each combinator to work two ways:

```ts
map(self, f)            // data-first: both args, run now
pipe(self, map(f))      // data-last: one arg, return a function waiting for self
```

`dual` makes one definition do both:

```ts
const dual = (arity, body) => (...args) =>
  args.length >= arity
    ? body(...args)              // enough args → run now (data-first)
    : (self) => body(self, ...args)  // too few → wait for self (data-last)
```

It counts the arguments. `map` has arity 2. Call `map(self, f)` — two args, it runs `body(self, f)`
now. Call `map(f)` — one arg, it returns `(self) => body(self, f)`, which is exactly what `pipe` needs.

The argument it always defers is `self`, the effect — because that's the one `pipe` will supply. That's
the whole "data-first vs data-last" idea: the body is written `self`-first, and the short call holds
that first slot open. Example step 3 proves the two forms are interchangeable: `map(succeed(1), f)` and
`pipe(succeed(1), map(f))` build the same effect and run to the same value.

## Which combinators get dual

The rule is simple: a combinator gets `dual` when its first argument is the effect it operates on —
the *transformers*. `flatMap`, `map`, `tap`, `catchAll`, `retry`, `timeout`, `provide` all take a
`self` first, so they're dual.

The *constructors* don't. `succeed`, `fail`, `sync`, `service` build an effect out of plain inputs —
there's no `self` to defer, so `pipe(x, succeed)` would be meaningless. And single-argument
combinators like `fork` are already pipe-friendly as-is: `pipe(self, fork)` just calls `fork(self)`.

(One honest exception in this toy: `catchTags` is left data-first. Its result type depends on which
tags you handle, which makes the data-last overload much hairier to write. The dual *principle* is
identical — real Effect does make `catchTags` dual; we skipped the type gymnastics.)

## Where this maps in real Effect

This is exactly how the real library works. Every pipeable Effect combinator is built with an internal
`dual` helper that counts arguments, and `import { pipe } from "effect"` is the same left-to-right
applier (real Effect also exposes `effect.pipe(...)` as a method, which does the same thing). None of
it is runtime machinery. It's the seam between "code that's pleasant to write" and "the data structure
the interpreter walks" — and that seam is the right note to end on.

## The whole tutorial, in one breath

You started with a claim: an Effect is a description, not a running program. Six parts later, that's
not a claim — it's something you built:

- An Effect is a **tree of tagged nodes** (`succeed`, `flatMap`, `async`, `service`, ...).
- A **fiber** is a loop with registers and a stack that walks the tree.
- **Sequencing** is a stack of postponed steps. **Failure** is a flag that throws away the success
  steps until it reaches a handler. **Async** is the loop returning out of itself and being called
  again later. **Dependencies** are a context register. **Concurrency** is more than one fiber.
  **Everything fancy** — `map`, `tap`, `retry`, `timeout`, `catchTags`, `forEachConcurrent` — is built
  from the same handful of primitives.
- And **pipe/dual** are sugar on top, gone before anything runs.

That's Effect. Not magic — mechanics.
