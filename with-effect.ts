// ============================================================
// THE SAME TASK, with Effect
//
// Same 7 requirements. Notice what becomes built-in operators
// vs. hand-written loops, and how errors + the client move INTO
// the types.
// ============================================================

import { Effect, Context, Schedule, Data } from "effect"

// ---- types ----
interface User { id: number; name: string }
interface Post { id: number; title: string }
interface PostWithCount { post: Post; comments: number }

// ---- typed errors: Data.TaggedError gives us the class + _tag for free ----
class NotFoundError extends Data.TaggedError("NotFound")<{ url: string }> {}
class NetworkError extends Data.TaggedError("Network")<{ message: string }> {}
// note: no TimeoutError — Effect.timeout provides its own, in the type.

// ---- the swappable HTTP client, declared as a SERVICE (a dependency) ----
// This is the big shift: the client isn't an argument we thread around.
// It's a requirement recorded in the Effect's type until we provide it.
class Http extends Context.Tag("Http")<
  Http,
  { get: <T>(url: string) => Effect.Effect<T, NotFoundError | NetworkError> }
>() {}

// ---- the logic. no http argument anywhere — it's pulled from context ----
const getUser = (id: number) =>
  Effect.gen(function* () {
    const http = yield* Http                 // ask context for the client
    return yield* http.get<User>(`/users/${id}`)
  })

const getPosts = (userId: number) =>
  Effect.gen(function* () {
    const http = yield* Http
    return yield* http.get<Post[]>(`/users/${userId}/posts`)
  })

// const getPosts = (userId: number) => Http.pipe(Effect.flatMap((http) => http.get<Post[]>(`/users/${userId}/posts`)))

const getCommentCount = (postId: number) =>
  Effect.gen(function* () {
    const http = yield* Http
    const comments = yield* http.get<unknown[]>(`/posts/${postId}/comments`)
    return comments.length
  })

const loadUserPosts = (userId: number) =>
  Effect.gen(function* () {
    const user = yield* getUser(userId)
    const posts = yield* getPosts(user.id)

    // concurrency: one option object, not a manual Promise.all
    const withCounts = yield* Effect.forEach(
      posts,
      (post) =>
        getCommentCount(post.id).pipe(
          Effect.map((comments): PostWithCount => ({ post, comments }))
        ),
      { concurrency: "unbounded" }
    )
    return withCounts
  })

// ---- retry policy: a value you can describe and reuse ----
// "retry 3 times, but only when the failure is a NetworkError"
const retryNetwork = Schedule.recurs(3).pipe(
  Schedule.whileInput((e: NotFoundError | NetworkError) => e._tag === "Network")
)

// ---- the real Http implementation, provided ONCE ----
const HttpLive = Http.of({
  get: <T>(url: string) =>
    Effect.gen(function* () {
      const res = yield* Effect.tryPromise({
        try: () => fetch(`https://jsonplaceholder.typicode.com${url}`),
        catch: () => new NetworkError({ message: `failed to reach ${url}` }),
      })
      if (res.status === 404) return yield* Effect.fail(new NotFoundError({ url }))
      if (!res.ok)
        return yield* Effect.fail(new NetworkError({ message: `bad status ${res.status}` }))
      return yield* Effect.tryPromise({
        try: () => res.json() as Promise<T>,
        catch: () => new NetworkError({ message: `bad json from ${url}` }),
      })
    }).pipe(Effect.retry(retryNetwork)), // retry applied at the source, once
})

// ---- compose all the behavior, then run ----
// Every line below is an operator on a value. Nothing runs until runPromise.
const program = loadUserPosts(1).pipe(
  Effect.timeout("2 seconds"),          // built-in. adds TimeoutException to the type.
  Effect.tap((result) => Effect.log(`loaded ${result.length} posts`)),
  Effect.catchTags({
    NotFound: (e) => Effect.log(`not found: ${e.url}`),
    Network: (e) => Effect.log(`network: ${e.message}`),
    TimeoutException: (e) => Effect.log(`timeout: ${e.message}`),
  }),
  // catchTags: the compiler KNOWS our error union and forces us to handle them
  Effect.provideService(Http, HttpLive), // satisfy the dependency, here at the edge
)

Effect.runPromise(program).then(console.log)
