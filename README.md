# The Comprehensive Effect Guide: What is it and How Does it Work

A hands-on guide to [Effect](https://effect.website), the TypeScript library for building complex
applications that stay readable and reliable as they grow.

It teaches Effect twice. First from the outside — what it is, why it exists, and what it feels like
to use, with the real `effect` library. Then from the inside — we rebuild a working version of Effect
from scratch, one concept at a time, until nothing about it is a black box.

The whole guide lives in [`tutorial/`](./tutorial/). Start there:

- **Part 1 — [What is Effect](./tutorial/01-what-is-effect/)** — the *why*. One small program
  (a web handler that reads a user from a database) written twice, plain and with Effect, to show the
  three problems Effect solves: invisible errors, threaded dependencies, and async coloring.
- **Part 2 — [How it works under the hood](./tutorial/02-under-the-hood/)** — the *how*. Six sections
  that build a tiny Effect runtime: foundations, async, context, errors, concurrency, ergonomics.

## What you need to follow along

- [Bun](https://bun.sh) to run the files.
- The dependencies installed once: `bun install`.

Then read the `README.md` in a folder and run the files next to it:

```bash
bun tutorial/01-what-is-effect/01-errors-without-effect.ts
```

Every code file runs and prints output. Every claim about how the real library works is checked
against the Effect source vendored in [`repos/effect`](./repos/effect); where the toy simplifies
something, the section's README says so.
