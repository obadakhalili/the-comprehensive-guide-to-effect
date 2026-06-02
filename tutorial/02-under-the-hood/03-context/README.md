# Section 2.3 — Context (dependencies)

New: a third type parameter `R`, a `Tag`, and `service` / `provide`.

This is where the `Effect<Success, Error, Requirements>` type finally gets its third slot. So far our
type was `Effect<A, E>`. Now it becomes `Effect<A, E, R>`, and `R` tracks what the effect still needs
from the outside before it can run.

```bash
bun tutorial/02-under-the-hood/03-context/example.ts
```

## Why this exists: stop threading dependencies by hand

Part 1 of the tutorial showed the pain: the repository needs a database, but to get it there you pass
`db` through every function in between, even the ones that don't use it. The dependency gets tangled
into call signatures.

The fix is the same move we've made every time: turn the thing into data. Instead of passing the
database as an argument, a function just says "I need the Database" — as a node in the description.
The runtime carries a bag of dependencies as it walks the tree, and fills that need in when it reaches
the node. Nobody in between has to know.

## A Tag names a dependency

A `Tag` is a small handle that names one dependency and remembers its type:

```ts
interface Database { findUser: (id: string) => string }
const Database = makeTag<Database>()("Database")
```

`Database` is now both a value (carrying the key `"Database"`) and a type (remembering the service is
`{ findUser: ... }`). It's how you refer to "the database dependency" in both worlds.

## service: read a dependency

```ts
const getUserName = (id: string) =>
  flatMap(service(Database), (db) => succeed(db.findUser(id)))
```

`service(Database)` is an effect that produces the database. Its type is the key part:

```ts
service(Database) : Effect<Database, never, "Database">
//                                          ^^^^^^^^^^ the requirement, in R
```

So `service` does two things: it produces the service as a value, *and* it records the need by putting
the tag's key into `R`. That's how the requirement gets into the type. And because `flatMap` unions
the `R`s of its parts (just like it unions the `E`s), the requirement flows up through every function
that uses `getUserName` — `greet` ends up with `R = "Database"` without ever naming it.

We model `R` as a **union of the dependency keys** an effect still needs. `service` adds a key;
`provide` (next) removes one. When `R` is `never`, nothing is missing.

## provide: supply a dependency

```ts
provide(greet("1"), Database, live)
```

This satisfies the requirement. Its return type removes the key from `R`:

```ts
provide<A, E, R, "Database", Database>(...) : Effect<A, E, Exclude<R, "Database">>
```

`Exclude<R, "Database">` drops `"Database"` from the union. So `greet("1")` (which is
`Effect<string, never, "Database">`) becomes `Effect<string, never, never>` after `provide` — and now
the runners will accept it. That's why `runSync(provide(greet("1"), Database, live))` compiles but the
commented `runSync(greet("1"))` does not: the runners require `R = never`, i.e. every dependency
provided. The example proves this with `@ts-expect-error` — the compiler rejects running an effect
that still needs something.

This is also the testing story from Part 1, made concrete. Step 1 of the example provides the live
database; step 2 provides a fake one. Same `greet`, different `provide`, no mocking library. You swap
a dependency by handing in a different object.

## How the runtime handles it: one register, two nodes

The runtime gains a `context` register — a `Map` from key to implementation — that it carries while
walking.

**`Service`** reads from it:

```ts
case "Service":
  if (context.has(node.key)) { value = context.get(node.key); inFailure = false }
  else { failure = { _tag: "MissingService", key: node.key }; inFailure = true }
```

It's just `Succeed`, except the value comes from the context instead of being baked in. (If the key is
missing it fails — but `R = never` means the types already guaranteed it's there.)

**`Provide`** writes to it — and this is the subtle one:

```ts
case "Provide": {
  const previous = context
  context = new Map(previous)        // copy, don't mutate
  context.set(node.key, node.impl)   // add the impl
  stack.push({ _op: "RestoreContext", context: previous }) // schedule the undo
  current = toPrimitive(node.self)   // run self with the new context
}
```

Two things to notice. First, it **copies** the context instead of mutating it. That keeps the new
dependency scoped to `self` only — siblings and parents don't see it, and you can provide different
implementations to different parts of one program without them stepping on each other. Second, it
pushes a `RestoreContext` frame so the old context comes back once `self` is done.

That restore frame is a new kind of frame, and it's transparent — it runs on the way back up whether
we're carrying a value or a failure:

```ts
if (frame._op === "RestoreContext") { context = frame.context; frame = stack.pop(); continue }
```

It doesn't consume the value or the failure. It just fixes the context and keeps unwinding. This is
the first frame we've seen that runs regardless of success or failure — the same pattern that later
powers cleanup and resource release.

So the trace for `provide(self, Database, impl)` is: copy-and-extend the context, push a restore, run
`self` (any `service(Database)` inside now finds the impl), and on the way out, restore. The
dependency exists exactly for the duration of `self`.

## Where this maps in real Effect

`service` is `OP_TAG` in `repos/effect/packages/effect/src/internal/core.ts`. The context register is
real — Effect carries an immutable `Context` while running, and `provide` layers onto it.

Two honest simplifications. First, real Effect has **no `Provide` primitive**; providing rides on
`OP_WITH_RUNTIME`, the node that gives access to the fiber's context so it can be read and locally
modified. We added an explicit `Provide` node because it's clearer to see. Second, we model `R` as a
union of string keys; real Effect uses the tag's identity type, which lets two different tags share a
service shape without colliding. The behavior — add a need with `service`, remove it with `provide`,
run when `R` is empty — is the same.

Next: [`04-errors/`](../04-errors/) — `catchAll`, `catchTags`, `retry`. So far a failure just unwinds
everything; now we catch it.
