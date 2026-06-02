# Part 2.5 — Concurrency

New methods: `fork`, `raceFirst`, `forEachConcurrent` (plus `sleep`, `timeout`).

Until now there's been one walk of the tree at a time. `flatMap` is strictly sequential: run a child,
get its value, run the next. You can never have two things in flight. This part fixes that. It
introduces the **Fiber** — one independent walk of the tree — and the ability to run several at once,
wait on them, and cancel the ones you stop caring about.

```bash
bun tutorial/02-under-the-hood/05-concurrency/example.ts
```

The example proves it: three 50ms tasks finish in ~50ms, not 150ms. They ran at the same time.

## The refactor: a Fiber is the bundle of state

Up to Part 4, the runtime kept its state — `current`, `stack`, `value`, `failure`, `context` — in
local variables inside `unsafeRun`. To run more than one walk at a time, that state has to be a thing
you can have many of. So it moves into a class:

```ts
class FiberRuntime {
  current; stack; value; failure; inFailure; context  // the same registers as before
  done; exitValue; observers                            // how it reports its result
  suspended; canceler                                   // for pausing and interruption
  step() { /* the exact same loop from Part 4 */ }
}
```

A **Fiber is just this object.** Not a thread, not magic — the registers and stack we've had all
along, now wrapped so you can make more than one. The `step()` method is the identical loop from Part
4 with one case added (`Fork`). Running a program now means: make a root `FiberRuntime` and call
`step()`.

`observers` is new and simple: a list of "who wants this fiber's result." When the fiber finishes,
`complete` calls each observer with the exit. That's how one fiber waits on another.

## fork: start a second walk

```ts
case "Fork": {
  const child = new FiberRuntime(node.self, this.context)
  queueMicrotask(() => child.step())  // run it independently, soon
  this.value = child                  // hand back the handle, right now
}
```

`fork` makes a new `FiberRuntime` for `self`, schedules it to run on its own, and gives the parent a
**handle** to it as the value — immediately, without waiting. The parent keeps going. So after `fork`,
you're holding a `Fiber` you can wait on later, while its work runs in the background.

`fork` alone just starts something. Everything useful is **fork + wait**, and the waiting is done with
an `Async` node that registers an observer on the fiber. That's the key connection: a fiber finishing
is an async event, so we wait for it with the same `async`/`resume` machinery from Part 2.

## raceFirst: fork both, take the first, interrupt the loser

```ts
raceFirst(a, b) =
  flatMap(fork(a), (fa) =>
    flatMap(fork(b), (fb) =>
      async((resume) => {
        let settled = false
        const onSettle = (loser) => (exit) => {
          if (settled) return
          settled = true
          loser.interrupt()             // cancel the one we don't need
          resume(exitToEffect(exit))    // continue with the winner's result
        }
        asRuntime(fa).addObserver(onSettle(asRuntime(fb)))
        asRuntime(fb).addObserver(onSettle(asRuntime(fa)))
      })))
```

Fork both. Put an observer on each. Whichever fires first wins: the `settled` flag makes sure only the
first counts, the loser gets interrupted, and `resume` continues the program with the winner's exit.
Example step 2: `fast` (20ms) beats `slow` (100ms), and `slow` is cancelled.

`timeout` is just `raceFirst` against a `sleep` that fails:

```ts
timeout(self, ms) = raceFirst(self, flatMap(sleep(ms), () => fail({ _tag: "Timeout", ms })))
```

If `self` finishes first, you get its value. If the sleep finishes first, you get a `Timeout` failure
and `self` is interrupted. Example step 3 shows the timeout firing.

## forEachConcurrent: fork all, wait for all

Same idea, more fibers. Fork an effect for every item, then an `Async` that waits for every observer
to fire and collects the results in order:

```ts
async((resume) => {
  let remaining = fibers.length
  fibers.forEach((fb, i) => fb.addObserver((exit) => {
    if (exit._tag === "Failure") { interrupt the rest; resume(fail(exit.error)) }
    else { results[i] = exit.value; if (--remaining === 0) resume(succeed(results)) }
  }))
})
```

If they all succeed, you get the array. If one fails, the rest are interrupted and the whole thing
fails — example step 4. That's why step 1 ran in ~50ms: all three were forked before any finished.

## Interruption: the canceler earns its keep

Back in Part 2, `async`'s register could return a value we ignored. Now it returns a **canceler** —
how to abort the work it started. `sleep` uses it:

```ts
const sleep = (ms) => async((resume) => {
  const timer = setTimeout(() => resume(succeed(undefined)), ms)
  return () => clearTimeout(timer)   // the canceler
})
```

When a fiber is interrupted, it runs that canceler and then resumes straight into a failure:

```ts
interrupt() {
  if (this.done || !this.suspended) return
  if (this.canceler) this.canceler()              // clearTimeout — stop the real work
  this.failure = { _tag: "Interrupted" }
  this.inFailure = true
  this.current = null
  this.step()                                      // unwind from here
}
```

This is why the example process exits cleanly instead of hanging. When `raceFirst`'s winner finishes,
the loser is sleeping; interrupting it calls `clearTimeout`, killing the pending timer. Without the
canceler, that timer would still fire later and keep the process alive even though the answer is
already in. So the canceler isn't decoration — it's what makes "stop the work you no longer need" real
instead of just ignoring a result.

(Our interruption is best-effort: a fiber that hasn't suspended yet — still sitting in the microtask
queue — can't be stopped. Real Effect handles that case with interruption flags; we skipped it.)

## Where this maps in real Effect

Real Effect's fiber is the same idea — a `FiberRuntime` with registers, a stack, observers, and a
`step` loop — just much richer (scheduling, interruption flags, supervision). One honest note: in real
Effect, `fork` isn't a standalone primitive op-code; forking happens through the runtime itself.
`raceFirst`, `forEach`, and `timeout` are all library functions built on fork-and-wait, exactly as we
built them. The cancelable `async` is the real `OP_ASYNC` — its register really does receive an
`AbortSignal` and can return a canceler, used precisely this way.

Next: [`06-ergonomics/`](../06-ergonomics/) — `pipe` and `dual`. No new runtime behavior at all, just
the sugar that makes all of this read top-to-bottom instead of inside-out.
