# Part 2 — How Effect works under the hood

We build our own tiny Effect, one concept at a time. Each part is a folder with three files:

- `runtime.ts` — the toy, complete up to and including this part. Self-contained and runnable.
- `example.ts` — a small program that uses the part's new methods. Run it with `bun`.
- `README.md` — the explainer: why the concept exists, how the runtime handles it, and where it maps
  in the real Effect source.

Each part extends the one before it. Read them in order.

| Part | Adds | The idea |
|------|------|----------|
| [01-foundations](./01-foundations/) | `succeed` `fail` `sync` `flatMap` `map` `tap` | an Effect is data; a loop with a stack runs it |
| [02-async](./02-async/) | `async` `tryPromise` | the loop steps out on a slow node and back in later |
| [03-context](./03-context/) | `service` `provide` | dependencies as a context register; the `R` type param |
| [04-errors](./04-errors/) | `catchAll` `catchTags` `retry` | a failure flag that skips steps until a handler |
| [05-concurrency](./05-concurrency/) | `fork` `raceFirst` `forEachConcurrent` | many fibers at once; interrupting the ones you don't need |
| [06-ergonomics](./06-ergonomics/) | `pipe` `dual` | source-level sugar, gone before the runtime runs |

The two representations to keep in mind throughout:

- The **public type** `Effect<A, E, R>` is opaque — it carries the three type parameters and nothing
  else. This is what gives users inference.
- The **internal value** is a tagged `Primitive` object the runtime walks. Constructors build a
  `Primitive` and cast it to `Effect`; the runtime casts back.

That split — a fully typed surface over a loosely typed interpreter — is how the real library is
built, and it's why a few `as` casts live inside each `runtime.ts`. The casts are localized to the
core; everything a user touches is type-safe.
