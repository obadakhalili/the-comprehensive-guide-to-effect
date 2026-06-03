# Part 2 — How Effect works under the hood

We build our own tiny Effect, one concept at a time. Part 2 is split into seven **sections**, numbered
2.1 to 2.7. The first six build the runtime; the last (2.7) uses it to write a real program. Each
section is a folder with three files:

- `runtime.ts` — our toy Effect, built up to this point. You can run it on its own; each section's
  copy includes everything from the sections before it. (2.7 adds no runtime — its `runtime.ts` just
  re-exports 2.6's.)
- `example.ts` — a small program that uses the new methods this section adds. Run it with `bun`.
- `README.md` — the explainer: why the concept exists, how the runtime handles it, and where it maps
  in the real Effect source.

Read the sections in order. The first six each add to the runtime from the section before it; the last
puts the whole thing to work.

| Section | Adds | The idea |
|------|------|----------|
| [2.1 — foundations](./01-foundations/) | `succeed` `fail` `sync` `flatMap` `map` `tap` | an Effect is data; a loop with a stack runs it |
| [2.2 — async](./02-async/) | `async` `tryPromise` | the loop pauses when it hits a promise, and continues once the promise resolves |
| [2.3 — context](./03-context/) | `service` `provide` | dependencies live in a context register; this is where the `R` type param comes from |
| [2.4 — errors](./04-errors/) | `catchAll` `catchTags` `retry` | a failure flag that throws away the success steps until it reaches a handler |
| [2.5 — concurrency](./05-concurrency/) | `fork` `raceFirst` `forEachConcurrent` | many fibers at once; interrupting the ones you no longer need |
| [2.6 — ergonomics](./06-ergonomics/) | `pipe` `dual` | source-level sugar that's gone before the runtime runs |
| [2.7 — real-world](./07-real-world/) | *(nothing new)* | a real concurrent, retrying, dependency-injected program built from everything above |

Two representations to keep in mind the whole way through:

- The **public type** `Effect<A, E, R>` is opaque — it carries the three type parameters and nothing
  else. This is the part users see and write against, and it's what makes inference work.
- The **value the runtime runs** is a different thing: a plain tagged object (we call it a
  `Primitive`) with an `_op` field like `"Succeed"` or `"OnSuccess"`. A constructor like `succeed`
  builds one of these objects, then casts it so its type *says* `Effect<A, E, R>`. The runtime casts
  it back to a `Primitive` and switches on `_op`.

So one object wears two faces: an `Effect<number>` to the person writing code, a
`{ _op: "Succeed", value: 10 }` to the loop running it. The whole surface a user touches is fully
typed; the casts only live inside the runtime, where the loop treats nodes loosely so it can switch
on `_op`. That's the same trade the real library makes, and it's why you'll see a few `as` casts in
each `runtime.ts`.
