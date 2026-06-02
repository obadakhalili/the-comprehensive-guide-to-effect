// ============================================================
// Reading a user profile — plain TypeScript.
//
// The shape every backend has: a handler calls a service, the service calls a
// repository, the repository talks to the database. Each layer can fail in its
// own way. Watch where those failures go, and what the types tell you about them.
//
// Run: bun tutorial/01-what-is-effect/01-errors-without-effect.ts
// ============================================================

interface User {
  id: string
  name: string
  email: string | null
}
interface Profile {
  name: string
  email: string
}

// the three ways this feature can fail. they're normal classes; we tag them so
// we can tell them apart later.
class UserNotFound extends Error {
  readonly _tag = "UserNotFound"
  constructor(readonly id: string) {
    super(`user ${id} not found`)
  }
}
class DbError extends Error {
  readonly _tag = "DbError"
  constructor(readonly reason: string) {
    super(`db error: ${reason}`)
  }
}
class ValidationError extends Error {
  readonly _tag = "ValidationError"
  constructor(readonly reason: string) {
    super(reason)
  }
}

const USERS: Record<string, User> = {
  "1": { id: "1", name: "Ada", email: "ada@example.com" },
  "2": { id: "2", name: "Linus", email: null }, // no email → fails validation downstream
}

// --- repository ---
// the signature says it returns a User. it does not say it can throw two
// different errors. you only learn that by reading the body.
function findUser(id: string): User {
  if (id === "999") throw new DbError("connection refused")
  const user = USERS[id]
  if (!user) throw new UserNotFound(id)
  return user
}

// --- service ---
// same problem, one layer up. the type is `Profile`. the throws are invisible,
// and they silently flow through this function on their way up.
function getProfile(id: string): Profile {
  const user = findUser(id)
  if (user.email === null) throw new ValidationError("user has no email")
  return { name: user.name, email: user.email }
}

// --- controller ---
interface HttpResponse {
  status: number
  body: string
}
function handleGetProfile(id: string): HttpResponse {
  try {
    const profile = getProfile(id)
    return { status: 200, body: JSON.stringify(profile) }
  } catch (err) {
    // `err` is `unknown`. we narrow by hand. nothing here forces us to cover
    // every case — if a new error type appears three layers down, this code
    // still compiles, and that error just falls into the 500 bucket unnoticed.
    if (err instanceof UserNotFound) return { status: 404, body: err.message }
    if (err instanceof ValidationError) return { status: 422, body: err.message }
    if (err instanceof DbError) return { status: 500, body: "internal error" }
    return { status: 500, body: "unknown error" }
  }
}

// --- the "router" calling the controller with a few requests ---
for (const id of ["1", "2", "3", "999"]) {
  console.log(id, "→", handleGetProfile(id))
}
