# The Comprehensive Guide to Effect.ts

This is a tutorial that teaches Effect twice.

First it shows you Effect from the outside: what it is, why it exists, and what it feels like to
use. Then it takes you inside and rebuilds a working version of Effect from scratch, one concept at
a time, so the magic turns into mechanics you can read.

The order is deliberate. You can't really trust a tool until you've seen what's under it. By the
end, an `Effect` value should feel like exactly what it is — a small data structure that a loop
walks — and nothing about retries, dependencies, or async should feel like a black box.

## How to read it

Every code file runs. Use [Bun](https://bun.sh):

```bash
bun tutorial/01-what-is-effect/01-errors-without-effect.ts
```

Read the `README.md` in a folder first, then run the files next to it.

## Part 1 — What is Effect

[`01-what-is-effect/`](./01-what-is-effect/) — the *why*. We take one small program (a web handler
that reads a user from a database) and write it twice: once in plain TypeScript, once in Effect.
You'll see three problems that plain code handles badly and Effect handles well:

- **Errors** — in plain code, the ways a function can fail are invisible. In Effect they're in the
  type, and the compiler won't let you forget one.
- **Dependencies** — in plain code, the database client gets threaded through every function. In
  Effect it's tracked in the type and supplied once, at the edge.
- **Async coloring** — in plain code, making one function async forces every caller to become
  async too. In Effect, sync and async compose the same way, with no `await` ladder.

These files use the real `effect` library.

## Part 2 — How it works under the hood

[`02-under-the-hood/`](./02-under-the-hood/) — the *how*. We build our own tiny Effect. Part 2 is six
**sections**, numbered 2.1 to 2.6. Each is a folder you can run, and each one extends the previous:

- **2.1** [`01-foundations/`](./02-under-the-hood/01-foundations/) — `succeed`, `fail`, `sync`,
  `flatMap`, `map`, `tap`. The core idea: an Effect is data, and a loop runs it.
- **2.2** [`02-async/`](./02-under-the-hood/02-async/) — `async`, `tryPromise`. How a loop pauses on a
  promise and picks back up.
- **2.3** [`03-context/`](./02-under-the-hood/03-context/) — `service`, `provide`. Dependencies as
  data, and where the `R` type parameter comes from.
- **2.4** [`04-errors/`](./02-under-the-hood/04-errors/) — `catchAll`, `catchTags`, `retry`. How
  failure short-circuits and how handlers catch it.
- **2.5** [`05-concurrency/`](./02-under-the-hood/05-concurrency/) — `fork`, `raceFirst`,
  `forEachConcurrent`. Running more than one thing at once, and cancelling.
- **2.6** [`06-ergonomics/`](./02-under-the-hood/06-ergonomics/) — `pipe`, `dual`. The sugar that
  makes the API read top-to-bottom instead of inside-out.

Every claim about how the real library works is checked against the Effect source in
[`repos/effect`](../repos/effect). Where our toy simplifies something, the README says so.
