# Part 2.4 — Error handling

New methods: `catchAll`, `catchTags`, `retry`.

So far a failure has no escape. When a node fails, the loop unwinds the whole stack and the program
ends as a `Failure`. This part adds the node that catches a failure and turns it into something else —
and shows that `catchTags` and `retry` are both just that node, used cleverly.

```bash
bun tutorial/02-under-the-hood/04-errors/example.ts
```

## Why this exists: you need to handle failure somewhere

Part 1 of the tutorial sold the idea of handling failure "at the edge." This is the machine that does
it. Without it, a typed error is only ever fatal — it propagates to the top and stops everything. With
it, you can recover: turn a `NotFound` into a 404 response, retry a flaky network call, fall back to a
default. The error stops being the end of the program and becomes a value you decide what to do with.

## catchAll: the one real new thing

```ts
const recovered = catchAll(fail(notFound("42")), (e) => succeed(`recovered from ${e._tag}`))
```

`catchAll` builds an `OnFailure` node: it holds `self` and a handler `g`. If `self` fails, `g` runs
with the error and returns the next effect. If `self` succeeds, `g` is skipped entirely.

The type tells the story:

```ts
catchAll<A, E, R, B, E2, R2>(self: Effect<A, E, R>, g: (e: E) => Effect<B, E2, R2>): Effect<A | B, E2, R | R2>
```

The error channel goes from `E` to `E2`. The original `E` is gone — `g` received it and dealt with it.
If `g` returns a `succeed`, you've recovered and `E2` might be `never`. If `g` returns a `fail`, that's
a new error, like rethrowing. This is `try/catch` as a value: the handler returns the effect that
replaces the failed one.

## How the runtime catches it

`OnFailure` is the mirror of `OnSuccess`. When the loop hits it, it pushes an `onFailure` frame and
runs `self`. The catching happens in the unwind half, which now checks the frame kind against whether
we're failing:

```ts
if (!inFailure && frame._op === "OnSuccess") { current = frame.f(value); break }   // value → run success step
if ( inFailure && frame._op === "OnFailure") { current = frame.g(failure); break } // failure → run handler
// otherwise: skip this frame and keep popping
```

That "otherwise: skip" line is the whole control-flow model in one place:

- A **value** runs the next `OnSuccess` and **skips** `OnFailure` frames. (Handlers don't fire on
  success.)
- A **failure** runs the next `OnFailure` and **skips** `OnSuccess` frames. (The short-circuit: the
  happy path is thrown away until a handler is found.)

Example step 4 shows this with depth. The `fail("boom")` is three `flatMap`s deep. It bubbles up,
skipping every `OnSuccess` frame in between — that's why the `console.log` never prints — until it
reaches the `OnFailure` frame from `catchAll`, which catches it. **Depth doesn't matter.** The failure
falls past every success step automatically until it hits a handler. The nearest handler wins; an outer
`catchAll` only sees the error if an inner one rethrows with `fail`.

## catchTags is catchAll plus a lookup

There's no `catchTags` node in the runtime. It's `catchAll` with a dispatch on `_tag`:

```ts
catchAll(self, (e) => {
  const handler = handlers[e._tag]
  return handler ? handler(e) : fail(e) // matched → run handler; unmatched → rethrow
})
```

If a handler exists for the error's tag, run it. If not, re-fail so some outer handler (or the top)
gets it. The types make each handler receive exactly its error variant — in the example,
`NotFound`'s handler sees `e.id`, `Network`'s sees `e.message` — and any tag you *don't* handle stays
in the result's error type. That's the `Exclude<E, { _tag: keyof H }>` in the signature: handled tags
are removed, unhandled tags remain. It's how, back in Part 1, deleting a handler made the controller
stop compiling — the unhandled error didn't disappear from the type.

## retry is catchAll pointing at itself

Also not a primitive. `retry` catches a failure and, if it's allowed to, runs the *same effect* again:

```ts
retry(self, { times, while: pred }) =
  catchAll(self, (e) =>
    times > 0 && pred(e)
      ? retry(self, { times: times - 1, while: pred })  // run self again with one less try
      : fail(e)                                          // out of tries (or wrong error) → give up
  )
```

Each retry is a fresh `catchAll` wrapped around the same `self`. Because `self` is just data, running
it again is free — it rebuilds from the same description. Example step 3 shows it: a flaky effect that
fails on attempts 1 and 2 and succeeds on 3. `retry` catches the first two failures, re-runs, and lets
the success through. It stops on three conditions: success, no tries left, or an error the `while`
predicate rejects.

So the shape to remember: **`catchAll` handles one failure; `catchTags` is `catchAll` that branches on
the tag; `retry` is `catchAll` that loops back to the start.** One node, three uses.

## Where this maps in real Effect

`catchAll` is `OP_ON_FAILURE` in `repos/effect/packages/effect/src/internal/core.ts`. Real `catchTags`
(`core-effect.ts`) does exactly the guarded lookup we wrote — it checks `hasProperty(e, "_tag")` before
dispatching, so an error without a `_tag` simply passes through uncaught. `retry` in real Effect is
more general (it takes a `Schedule` value describing the retry policy — delays, backoff, limits) but at
its core it's the same recover-and-rerun loop.

Two honest simplifications worth knowing:

1. **Exit is one-or-the-other.** Notice `Exit` is a tagged union: `Success` with a value, or `Failure`
   with an error — never both. That's deliberate; it makes "succeeded but also has an error" impossible
   to represent.
2. **We collapse the `Cause`.** Real Effect doesn't put your raw error in the failure slot — it wraps
   it in a `Cause`, a small tagged structure that distinguishes a normal typed failure (`Fail`) from a
   *defect* (`Die` — an unexpected `throw`, like a bug) from an interruption (`Interrupt`). `catchAll`
   in real Effect catches only `Fail`, not `Die`. Our toy has a single error slot, so when a `Sync`
   thunk throws, we treat it as an ordinary failure and `catchAll` would catch it — real Effect would
   not. The `Cause` layer is what we traded away for simplicity.

Next: [`05-concurrency/`](../05-concurrency/) — `fork`, `raceFirst`, `forEachConcurrent`. Running more
than one of these loops at once, and cancelling the losers.
