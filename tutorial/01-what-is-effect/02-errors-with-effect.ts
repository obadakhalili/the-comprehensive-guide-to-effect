// ============================================================
// The same feature — with Effect.
//
// Same three layers, same three failures. The difference: the failures are now
// in the types, and the compiler makes the controller handle every one.
//
// Run: bun tutorial/01-what-is-effect/02-errors-with-effect.ts
// ============================================================

import { Effect, Data } from "effect"

interface User {
  id: string
  name: string
  email: string | null
}
interface Profile {
  name: string
  email: string
}

// Data.TaggedError gives each error a `_tag` and a typed payload, for free.
class UserNotFound extends Data.TaggedError("UserNotFound")<{ id: string }> {}
class DbError extends Data.TaggedError("DbError")<{ reason: string }> {}
class ValidationError extends Data.TaggedError("ValidationError")<{ reason: string }> {}

const USERS: Record<string, User> = {
  "1": { id: "1", name: "Ada", email: "ada@example.com" },
  "2": { id: "2", name: "Linus", email: null },
}

// --- repository ---
// the return type now states the failures: Effect<User, UserNotFound | DbError>.
// the success value is User; the things that can go wrong are written down too.
const findUser = (id: string): Effect.Effect<User, UserNotFound | DbError> =>
  Effect.gen(function* () {
    if (id === "999") return yield* Effect.fail(new DbError({ reason: "connection refused" }))
    const user = USERS[id]
    if (!user) return yield* Effect.fail(new UserNotFound({ id }))
    return user
  })

// --- service ---
// read this body as if nothing fails. `yield* findUser(id)` gives you a User and
// moves on. if findUser fails, this function stops here on its own — you don't
// write that. the error just gets added to THIS function's error type.
const getProfile = (id: string): Effect.Effect<Profile, UserNotFound | DbError | ValidationError> =>
  Effect.gen(function* () {
    const user = yield* findUser(id)
    if (user.email === null) return yield* Effect.fail(new ValidationError({ reason: "user has no email" }))
    return { name: user.name, email: user.email }
  })

interface HttpResponse {
  status: number
  body: string
}

// --- controller ---
// the return type is Effect<HttpResponse> — meaning the error channel is `never`,
// i.e. every error has been handled. catchTags makes us handle each one by tag.
// delete any handler below and this annotation stops compiling: the unhandled
// error stays in the type. that's the compiler refusing to let you forget a case.
const handleGetProfile = (id: string): Effect.Effect<HttpResponse> =>
  getProfile(id).pipe(
    Effect.map((profile): HttpResponse => ({ status: 200, body: JSON.stringify(profile) })),
    Effect.catchTags({
      UserNotFound: (e) => Effect.succeed<HttpResponse>({ status: 404, body: `user ${e.id} not found` }),
      ValidationError: (e) => Effect.succeed<HttpResponse>({ status: 422, body: e.reason }),
      DbError: () => Effect.succeed<HttpResponse>({ status: 500, body: "internal error" }),
    })
  )

for (const id of ["1", "2", "3", "999"]) {
  console.log(id, "→", await Effect.runPromise(handleGetProfile(id)))
}
