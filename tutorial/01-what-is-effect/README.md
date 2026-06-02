# Part 1 — What is Effect

## The one-line answer

Effect is a TypeScript library for building complex applications that stay readable and reliable as
they grow.

It does that with one core idea, which the official docs put like this: *use the type system to track
errors and context, not just success values.* A normal function's type tells you what it returns when
everything goes right. Effect's type tells you that, plus how it can go wrong, plus what it needs to
run.

Those last two — how it fails, what it needs — are things a normal type leaves out, so they turn into
surprises: an exception you didn't know could happen, a dependency you forgot to wire up. (Async is a
different story. It *is* in the type — `Promise<string>` says "async" loud and clear — but that's its
own problem: the announcement spreads to every caller. We get to that as Problem 3.) Effect's job is
to put the failures and the dependencies into the type too, and to stop the async announcement from
spreading — so all three stay under control as the program gets bigger.

That type is:

```ts
Effect<Success, Error, Requirements>
```

- **Success** — the value you get if it works.
- **Error** — the ways it can fail, as values, not thrown exceptions.
- **Requirements** — what it needs from the outside (its dependencies).

Here's the smallest possible before/after. A plain function that can fail:

```ts
const divide = (a: number, b: number): number => {
  if (b === 0) throw new Error("Cannot divide by zero")
  return a / b
}
```

The type says `number`. It does not say "or throws." You only find the failure by reading the body.
The same thing in Effect:

```ts
import { Effect } from "effect"

const divide = (a: number, b: number): Effect.Effect<number, Error> =>
  b === 0 ? Effect.fail(new Error("Cannot divide by zero")) : Effect.succeed(a / b)
```

Now the failure is in the type. The caller can see it without reading the body, and the compiler
can make sure they deal with it.

The rest of this part shows why that matters on a real-shaped program, not a one-liner. We take one
small feature — a web handler that reads a user profile from a database — and write it twice. The
program has the shape every backend has: **a handler calls a service, the service calls a
repository, the repository talks to the database.**

## Problem 1: errors are invisible

Run the plain version first:

```bash
bun tutorial/01-what-is-effect/01-errors-without-effect.ts
```

Look at `findUser` in [`01-errors-without-effect.ts`](./01-errors-without-effect.ts). Its signature
is `(id: string) => User`. But it can throw two different errors — `UserNotFound` and `DbError`.
The signature says nothing about them. The same is true of `getProfile` one layer up: its type is
`Profile`, but three different failures flow through it on their way to the top.

So all the error knowledge ends up in one `catch` block in the controller:

```ts
catch (err) {
  // err is `unknown`. we narrow by hand.
  if (err instanceof UserNotFound) return { status: 404, body: err.message }
  if (err instanceof ValidationError) return { status: 422, body: err.message }
  if (err instanceof DbError) return { status: 500, body: "internal error" }
  return { status: 500, body: "unknown error" }
}
```

Two things are wrong here, and neither is your fault — the language just works this way:

1. `err` is `unknown`. The type system has no idea what can actually arrive, so you're guessing.
2. Nothing forces this list to be complete. If someone adds a new error type three layers down, this
   code still compiles. The new error silently falls into the `unknown` bucket and becomes a 500.

Now the Effect version:

```bash
bun tutorial/01-what-is-effect/02-errors-with-effect.ts
```

In [`02-errors-with-effect.ts`](./02-errors-with-effect.ts), every layer states its failures:

```ts
const findUser = (id: string): Effect.Effect<User, UserNotFound | DbError> => ...
const getProfile = (id: string): Effect.Effect<Profile, UserNotFound | DbError | ValidationError> => ...
```

The win is what happens to the body of `getProfile`:

```ts
Effect.gen(function* () {
  const user = yield* findUser(id)
  if (user.email === null) return yield* Effect.fail(new ValidationError({ reason: "user has no email" }))
  return { name: user.name, email: user.email }
})
```

Read that as if it never fails. `yield* findUser(id)` gives you a `User` and moves to the next line.
You don't write "and if findUser failed, stop and propagate the error" — that happens on its own.
**You read the happy path; failure is handled somewhere else.** That "somewhere else" is the edge:

```ts
const handleGetProfile = (id: string): Effect.Effect<HttpResponse> =>
  getProfile(id).pipe(
    Effect.map((profile): HttpResponse => ({ status: 200, body: JSON.stringify(profile) })),
    Effect.catchTags({
      UserNotFound: (e) => Effect.succeed<HttpResponse>({ status: 404, body: `user ${e.id} not found` }),
      ValidationError: (e) => Effect.succeed<HttpResponse>({ status: 422, body: e.reason }),
      DbError: () => Effect.succeed<HttpResponse>({ status: 500, body: "internal error" }),
    })
  )

```

The return type is `Effect.Effect<HttpResponse>`. The error slot is empty (`never`) — every failure
has been handled. And `catchTags` is checked: each handler is matched to a real error tag, and if
you delete one, the unhandled error stays in the type and that `Effect.Effect<HttpResponse>`
annotation stops compiling. So you can't forget a case. The compiler keeps the list complete for
you — the exact thing the plain `catch` couldn't do.

This is the feeling to take away: **you write each layer as if it always succeeds, and you handle
every failure once, at the edge, with the compiler making sure the list is complete.**

## Problem 2: dependencies get threaded everywhere

The repository needs a database client. Only the repository uses it. But in plain code, the only way
to get it there is to pass it through every function in between.

```bash
bun tutorial/01-what-is-effect/03-deps-without-effect.ts
```

In [`03-deps-without-effect.ts`](./03-deps-without-effect.ts), look at the signatures:

```ts
function findUser(db: Db, id: string): User       // actually uses db
function getProfile(db: Db, id: string): Profile  // doesn't — just forwards it
function handleGetProfile(db: Db, id: string)      // same — just forwards it
```

`getProfile` and `handleGetProfile` have no business knowing about a database, but they both carry
`db` just to pass it down. And to test `getProfile`, you have to build a fake `Db` and thread it in
by hand. The dependency is tangled into every call.

**"Why not just import the `db` in the repository, where it's actually used?"** It's the obvious
question, and for a toy like this you could. Two reasons it doesn't hold up:

1. A function that reaches out to an imported `db` takes a hidden input. Its type says
   `(id: string) => User`, but it really depends on a module-level thing you can't see in the
   signature. That's harder to reason about, and harder to test — to swap the database for a fake,
   you now have to mock the *module*, not just pass a different argument. A function whose inputs are
   all explicit is the clean one: you read its signature and you know everything it touches.
2. A single imported `db` assumes one global database client for the whole process. Real apps often
   can't make that assumption. The client is frequently built **per request** — it carries the
   logged-in user's identity so the database can enforce row-level security (each request only sees
   its own rows). There's no one `db` to import; there's a different one for every request. So you
   need a way to supply it at the point you run the program, not hard-code it at the top of a file.

Both point at the same fix: make the dependency something the program *asks for* and you *supply from
the outside*, per run. That's exactly what Effect does.

Now the Effect version:

```bash
bun tutorial/01-what-is-effect/04-deps-with-effect.ts
```

In [`04-deps-with-effect.ts`](./04-deps-with-effect.ts), the database is declared as a *service*:

```ts
class Database extends Context.Tag("Database")<
  Database,
  { readonly findUser: (id: string) => Effect.Effect<User, UserNotFound> }
>() {}
```

The repository asks for it; nobody else mentions it:

```ts
const findUser = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database // pull it from context
    return yield* db.findUser(id)
  })

const getProfile = (id: string) =>
  Effect.gen(function* () {
    const user = yield* findUser(id) // no `db` here
    return { name: user.name, email: user.email }
  })
```

So where did the dependency go? Into the **third slot of the type** — the `R` we skipped earlier:

```ts
Effect.Effect<Profile, UserNotFound, Database>
//                                    ^^^^^^^^ "this needs a Database to run"
```

The requirement rides along in the type, automatically, through every function that uses `findUser`,
without any of them naming it. You satisfy it once, at the edge:

```ts
handleGetProfile(id).pipe(Effect.provideService(Database, DatabaseLive))
```

After `provideService`, the `R` slot is `never` — nothing left to provide — and the program can run.
To test, you provide a different `Database` here and change nothing else. **The dependency is in the
type, not in the call signatures.**

## Problem 3: async coloring

This one is subtle, so here it is on its own:

```bash
bun tutorial/01-what-is-effect/05-coloring.ts
```

In plain JavaScript, `async` is contagious. The moment `loadName` becomes async, `greet` has to
become `async`, add an `await`, and return a `Promise` — and then every caller of `greet` has to do
the same, all the way up. Look at the two plain versions in
[`05-coloring.ts`](./05-coloring.ts): going from `loadNameSync` to `loadNameAsync` forced `greetSync`
to turn into `greetAsync`. One change, a ripple up the whole chain.

The reason is the type. A `Promise<string>` announces "I'm async," and that announcement spreads to
everyone who touches it.

Effect's type doesn't carry that announcement. `Effect<string>` is the same type whether the work is
sync or async. So `greet` is written once and never mentions either:

```ts
const greet = (loadName: (id: string) => Effect.Effect<string>) => (id: string) =>
  Effect.gen(function* () {
    const name = yield* loadName(id)
    return `hello, ${name}`
  })
```

And it runs unchanged whether you hand it a sync step or an async one:

```ts
const loadNameSyncE = (id: string) => Effect.sync(() => `user-${id}`)
const loadNameAsyncE = (id: string) => Effect.promise(() => Promise.resolve(`user-${id}`))

greet(loadNameSyncE)("1")  // works
greet(loadNameAsyncE)("1") // SAME greet, also works
```

`greet` didn't change. Only the step you passed in did. The "sync vs async" decision is no longer in
the type, so it doesn't spread. It's handled at runtime, when the program actually runs — which is
exactly what Part 2 explains.

## What's actually going on

You may have noticed: in every Effect version, nothing ran until `Effect.runPromise` at the very
bottom. `findUser(id)`, `getProfile(id)`, even the whole `handleGetProfile(id)` — calling those
built **values**. They didn't do anything. The database wasn't touched until `runPromise`.

That's the secret the whole library is built on, and it's the bridge to the rest of this tutorial:

> An `Effect` is not a running program. It's a **description** of one — a plain data structure. It
> sits there doing nothing until a runtime walks it and carries it out.

Everything in Part 1 falls out of that one fact. Errors can be in the type because they're values in
the description, not exceptions that escape. Dependencies can be in the type because "I need a
Database" is just a node in the description, waiting to be filled in. Sync and async can share a type
because the description doesn't run yet — the runtime decides how at the moment it does.

So the natural next question is: what *is* that description, exactly, and what does the runtime that
walks it look like? That's Part 2. We'll build both from scratch.
