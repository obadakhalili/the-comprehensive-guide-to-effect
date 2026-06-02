# Section 2.2 — Async

New methods: `async`, `tryPromise`.

Section 2.1 built a loop that runs a tree of nodes. But every node finished instantly. Real programs
wait — on a network call, a timer, a file. This part adds the one node that can take time, and the
one trick that makes it work: the loop can stop, and start again later.

```bash
bun tutorial/02-under-the-hood/02-async/example.ts
```

## Why this exists: the loop can't just wait

When the loop hits a node that takes 50ms, it has a problem. It can't sit and spin — that freezes the
whole thread, and nothing else runs. It can't block — JavaScript is single-threaded, blocking freezes
everything too. So it does the only thing left: it **stops**, and arranges to be **restarted** when
the answer arrives.

That's the entire idea of async here. A slow node says "I don't have a value yet — here's how to
reach me when I do," and the loop walks away until it's reached.

## The `Async` node

```ts
{ _op: "Async"; register: (resume: (effect) => void) => void }
```

It holds one function, `register`. The runtime calls `register` and hands it a `resume` callback.
`register`'s job is to start the async work and call `resume(someEffect)` when it finishes. Two sides,
two owners:

- **`register`** — you write it. "Start the work." (Start a timer, start a fetch, listen for an
  event.)
- **`resume`** — the runtime writes it. "I have my answer, runtime, continue." You call it when the
  work is done, passing a `succeed(...)` or a `fail(...)`.

It's callback-based because the bottom layer of JavaScript is callback-based. `setTimeout`,
`socket.on`, `fs.readFile`, even `new Promise((resolve) => ...)` — they all deliver "later" results by
calling a function you gave them. `async` is where our toy meets that layer, so it speaks its language.

## How the loop pauses and resumes

Here's the whole mechanism, from the runtime:

```ts
case "Async": {
  const resume = (next) => {
    current = toPrimitive(next) // the result, as an effect
    step()                      // re-enter the loop
  }
  node.register(resume)         // start the work
  return                        // LEAVE the loop. the thread is now free.
}
```

Read the order carefully, because it's the heart of it:

1. Build `resume`.
2. Call `register(resume)` — this starts the promise/timer **now**, synchronously.
3. `return` — the loop exits. `step()` is done. The JS call stack empties. The thread is free to do
   anything else.
4. ...time passes...
5. The work finishes and calls `resume(succeed(value))`.
6. `resume` sets `current` and calls `step()` again — the loop runs **again**, on the same `stack`,
   `value`, `failure` it left behind, and keeps going as if it never left.

The thing that makes this safe: `current`, `stack`, `value`, and `failure` are not local variables
that vanish when `step` returns. They live in the closure around `step`. So when the loop walks away,
its state is frozen, not lost. "Pause" is just `return` out of `step`. "Resume" is just calling
`step` again. The state in between is the fiber's memory.

This is also the answer to the coloring problem from Part 1. You never wrote `await`. The *loop*
decided to step out on a slow node and come back. A sync node and an async node sit in the same chain;
the only difference is that the async one makes the loop leave and re-enter. So sync and async compose
the same way, with nothing marked.

## `tryPromise` is built on `async`

There's no timer, no special promise handling in `tryPromise`. It's a thin wrapper:

```ts
const tryPromise = (options) =>
  async((resume) => {
    options.try().then(
      (value) => resume(succeed(value)),       // resolved → success
      (error) => resume(fail(options.catch(error)))  // rejected → typed failure
    )
  })
```

`.then` is the `register`: it starts the promise and arranges to call `resume` on settle. A resolve
becomes `succeed`; a reject runs your `catch` to make a typed error and becomes `fail`. That's it.
Step 4 in the example shows the reject path — a rejected promise turns into a normal `Failure` exit,
the same shape any other failure has.

So when you use `tryPromise` (or, in Part 1, `Effect.tryPromise`), you're using this callback dance —
it's just written for you. You hand over `() => fetch(...)` and never see `resume`.

## Why running now returns a Promise

In Section 2.1, `runSyncExit` walked the tree and handed back the answer immediately, because every node
finished at once. Now a node can pause. So the runner can't always have an answer when you call it —
it might be parked, waiting. That's why the main runner is now `runPromise`: it gives you a Promise up
front and resolves it from inside `resume`, whenever that fires.

The engine, `unsafeRun`, takes a callback and calls it with the final exit. `runPromiseExit` wraps
that in a Promise. And `runSyncExit` reuses the same engine with a trick:

```ts
const runSyncExit = (effect) => {
  let result
  unsafeRun(effect, (exit) => { result = exit })
  if (result === undefined) throw new Error("...async — use runPromise")
  return result
}
```

If the tree is fully sync, `unsafeRun` finishes before it returns, so `result` is set. If the tree
parks on an `Async` node, `unsafeRun` returns with `result` still unset — so we throw. That's why step
3 in the example throws: `runSyncExit` on an async program has no value to give you.

This is exactly the real `runSync` vs `runPromise` split. `runPromise` always works. `runSync` is an
opt-in "I promise this is sync" that fails loudly if you're wrong. And — important — this is the *only*
place the sync/async choice shows up: once, at the edge, when you run. Everywhere else, sync and async
are the same `Effect`.

## Where this maps in real Effect

`async` is `OP_ASYNC` in `repos/effect/packages/effect/src/internal/core.ts`. The real version is the
same shape, with two additions we'll get to: the register also receives an `AbortSignal`, and it can
return a *canceler* — both used for interruption in Section 2.5. The real `tryPromise`
(`core-effect.ts`) is `core.async(resume => { evaluate().then(a => resume(succeed(a)), e => resume(fail(...))) })` —
the same `.then` dance we wrote.

Next: [`03-context/`](../03-context/) — `service` and `provide`, and where the `R` type parameter
comes from.
