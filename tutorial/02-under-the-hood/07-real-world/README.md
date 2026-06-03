# Section 2.7 — Putting it together

No new runtime. This section uses the finished toy from Section 2.6 to write a real program, so
`runtime.ts` just re-exports it.

```bash
bun tutorial/02-under-the-hood/07-real-world/example.ts
```

## The task

Load a user, their posts, and a comment count for each post — concurrently — retrying transient
network errors, with an overall timeout, and every failure handled once at the edge.

That sentence touches every part of the runtime:

| The task needs | Built in |
| --- | --- |
| a swappable HTTP client, not threaded through every call | `service` / `provide` — Section 2.3 |
| turn promises (a fetch) into effects | `tryPromise` / `async` — Section 2.2 |
| fetch all comment counts at once | `forEachConcurrent` — Section 2.5 |
| give up after N seconds | `timeout` — Section 2.5 |
| retry only network errors | `retry` — Section 2.4 |
| handle each failure by its tag, at the edge | `catchTags` — Section 2.4 |
| read top-to-bottom | `pipe` — Section 2.6 |

Nothing new is needed. The ~20 functions from 2.1–2.6 are enough to write the whole thing.

## What `gen` would add

Real Effect lets you write this with generator syntax (`Effect.gen(function* () { const user = yield*
getUser(id); const posts = yield* getPosts(user.id); ... })`). We never built that. For a straight
chain like `loadUserPosts`, `pipe` handles it fine. `gen` earns its keep when a later step needs a
value bound several steps *earlier*: with `pipe` you'd have to nest to keep it in scope, while `gen`
lets you just refer to it. That's the case it's for.

## What the example shows

- The HTTP client is a **service** (`Http`), provided once at the edge. Swap `HttpLive` for a fake
  and nothing in the business logic changes.
- One endpoint glitches twice on purpose. `retry` at the source heals it — you'll see the two retry
  lines in the output, then a successful result.
- The two comment-count fetches run concurrently (`forEachConcurrent`), not one after another.
- `catchTags` is the one combinator we left data-first (see Section 2.6), so the example hands it
  `self` with a small arrow inside the `pipe`.

## What the types force — and what they don't

Easy to overstate, so be precise:

- **Dependencies are enforced.** `provide` must bring `R` to `never`, or the runners won't accept the
  program.
- **Errors are not.** `runPromise` (like real Effect's) takes an effect with leftover errors and just
  rejects the promise if one occurs.
- What makes you handle every case is the **annotation**: `program` is declared
  `Effect<…, never, never>`, so when `timeout` adds `TimeoutError`, deleting its handler leaves an
  error that no longer matches `never`, and it stops compiling. Drop the annotation and it compiles
  fine, unhandled error and all. Handling everything is something you opt into by committing to an
  empty error channel.

## Recap

Part 1 started with a claim: an Effect is a description, not a running program. Seven sections later,
you've built it and used it to write the program above:

- An Effect is a **tree of tagged nodes** (`succeed`, `flatMap`, `async`, `service`, ...).
- A **fiber** is a loop with registers and a stack that walks the tree.
- **Sequencing** is a stack of postponed steps. **Failure** is a flag that throws away the success
  steps until it reaches a handler. **Async** is the loop returning out of itself and being called
  again later. **Dependencies** are a context register. **Concurrency** is more than one fiber.
  **Everything else** — `map`, `tap`, `retry`, `timeout`, `catchTags`, `forEachConcurrent` — is built
  from the same handful of primitives.
- And **pipe/dual** are sugar on top, gone before anything runs.

That's all Effect is underneath: a data structure, and a loop that walks it. The program above is
built from nothing more.
