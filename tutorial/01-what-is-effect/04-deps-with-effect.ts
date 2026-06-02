// ============================================================
// Dependencies — with Effect.
//
// The database is declared as a service. No function takes a `db` argument. The
// requirement lives in the type (the third slot, R) until you satisfy it once,
// at the edge, with provideService.
//
// Run: bun tutorial/01-what-is-effect/04-deps-with-effect.ts
// ============================================================

import { Effect, Context, Data } from "effect"

interface User {
  id: string
  name: string
  email: string
}
interface Profile {
  name: string
  email: string
}

class UserNotFound extends Data.TaggedError("UserNotFound")<{ id: string }> {}

// declare the dependency as a Tag: "there exists a Database that can findUser".
// the second type argument is the service's shape.
class Database extends Context.Tag("Database")<
  Database,
  { readonly findUser: (id: string) => Effect.Effect<User, UserNotFound> }
>() {}

// --- repository: asks the context for the Database, then uses it ---
const findUser = (id: string): Effect.Effect<User, UserNotFound, Database> =>
  Effect.gen(function* () {
    const db = yield* Database // pull the service out of context
    return yield* db.findUser(id)
  })

// --- service: no `db` parameter. it just calls findUser ---
// note the type: the `Database` requirement is carried along automatically (R).
const getProfile = (id: string): Effect.Effect<Profile, UserNotFound, Database> =>
  Effect.gen(function* () {
    const user = yield* findUser(id)
    return { name: user.name, email: user.email }
  })

interface HttpResponse {
  status: number
  body: string
}

// --- controller: also no `db`. errors handled; Database still required (R) ---
const handleGetProfile = (id: string): Effect.Effect<HttpResponse, never, Database> =>
  getProfile(id).pipe(
    Effect.map((profile): HttpResponse => ({ status: 200, body: JSON.stringify(profile) })),
    Effect.catchTags({
      UserNotFound: (e) => Effect.succeed<HttpResponse>({ status: 404, body: `user ${e.id} not found` }),
    })
  )

// the real implementation of the Database service.
const DatabaseLive = Database.of({
  findUser: (id) => {
    const found = ({ "1": { id: "1", name: "Ada", email: "ada@example.com" } } as Record<string, User>)[id]
    return found ? Effect.succeed(found) : Effect.fail(new UserNotFound({ id }))
  },
})

// satisfy the requirement ONCE, at the edge. after provideService, R is `never`,
// so the program can run. to test, you'd provide a different Database here.
for (const id of ["1", "2"]) {
  const response = await Effect.runPromise(
    handleGetProfile(id).pipe(Effect.provideService(Database, DatabaseLive))
  )
  console.log(id, "→", response)
}
