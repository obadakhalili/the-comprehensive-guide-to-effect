// ============================================================
// Dependencies — plain TypeScript.
//
// The repository needs a database client. Only the repository uses it. But to
// get it there, every function above has to accept it and pass it along. Watch
// `db` appear in signatures that have no business knowing about a database.
//
// Run: bun tutorial/01-what-is-effect/03-deps-without-effect.ts
// ============================================================

interface User {
  id: string
  name: string
  email: string
}
interface Profile {
  name: string
  email: string
}

class UserNotFound extends Error {
  readonly _tag = "UserNotFound"
  constructor(readonly id: string) {
    super(`user ${id} not found`)
  }
}

// the dependency: a database client.
interface Db {
  find: (id: string) => User | undefined
}

// --- repository: actually uses db ---
function findUser(db: Db, id: string): User {
  const user = db.find(id)
  if (!user) throw new UserNotFound(id)
  return user
}

// --- service: doesn't use db at all, but must take it and pass it down ---
function getProfile(db: Db, id: string): Profile {
  const user = findUser(db, id)
  return { name: user.name, email: user.email }
}

// --- controller: same — `db` is here only to be forwarded ---
interface HttpResponse {
  status: number
  body: string
}
function handleGetProfile(db: Db, id: string): HttpResponse {
  try {
    return { status: 200, body: JSON.stringify(getProfile(db, id)) }
  } catch (err) {
    if (err instanceof UserNotFound) return { status: 404, body: err.message }
    return { status: 500, body: "internal error" }
  }
}

// the edge builds the real db and threads it through everything.
const db: Db = {
  find: (id) => ({ "1": { id: "1", name: "Ada", email: "ada@example.com" } })[id],
}

for (const id of ["1", "2"]) {
  console.log(id, "→", handleGetProfile(db, id))
}

// To test getProfile, you'd have to build a fake `Db` and pass it in by hand at
// every call. The dependency is tangled into the call signatures.
