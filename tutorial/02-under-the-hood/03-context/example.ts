// =================================================================
// Section 2.3 example. Run: bun tutorial/02-under-the-hood/03-context/example.ts
// =================================================================

import { makeTag, service, provide, succeed, flatMap, map, runSync, type Effect } from "./runtime"

// declare a dependency: a Database service that can find a user's name.
interface Database {
  findUser: (id: string) => string
}
const Database = makeTag<Database>()("Database")

// the repository asks the context for the Database. notice the inferred type:
// Effect<string, never, "Database"> — the requirement is tracked automatically.
const getUserName = (id: string) => flatMap(service(Database), (db) => succeed(db.findUser(id)))

// a layer up. it never mentions Database, but the requirement rides along in R.
const greet = (id: string): Effect<string, never, "Database"> =>
  map(getUserName(id), (name) => `hello, ${name}`)

// this function is never called. it only shows the compiler refuses to run an
// effect whose requirement isn't satisfied yet.
function _typeCheckOnly() {
  // @ts-expect-error greet("1") still requires "Database"; runSync needs R = never
  runSync(greet("1"))
}

// the real Database.
const live: Database = { findUser: (id) => `user-${id}` }
console.log("1) with the live db   :", runSync(provide(greet("1"), Database, live)))

// a fake Database for "tests" — no mocking library, just a different object.
const fake: Database = { findUser: () => "TEST-USER" }
console.log("2) with a fake db      :", runSync(provide(greet("1"), Database, fake)))
