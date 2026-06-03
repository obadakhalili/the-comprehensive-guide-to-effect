// =================================================================
// Section 2.7 example — a real program, built entirely on the toy runtime.
// Run: bun tutorial/02-under-the-hood/07-real-world/example.ts
//
// The task: load a user, their posts, and a comment count for each post
// (concurrently), retrying transient network errors, with a timeout, and
// every failure handled once at the edge. No new runtime — just the ~20
// functions built across 2.1–2.6, composed with pipe.
// =================================================================

import {
  type Effect,
  makeTag, service, succeed, fail, sync, sleep,
  flatMap, map, tap, retry, timeout, catchTags, provide,
  forEachConcurrent, pipe, runPromise,
} from "./runtime"

// ---- domain types ----
interface User { id: number; name: string }
interface Post { id: number; title: string }
interface PostWithCount { post: Post; comments: number }

// ---- typed errors as plain tagged objects (what catchTags dispatches on) ----
interface NotFoundError { readonly _tag: "NotFound"; readonly url: string }
interface NetworkError { readonly _tag: "Network"; readonly message: string }
const notFound = (url: string): NotFoundError => ({ _tag: "NotFound", url })
const network = (message: string): NetworkError => ({ _tag: "Network", message })

// ---- the HTTP client, declared as a SERVICE (a dependency tracked in R) ----
interface Http {
  get: <T>(url: string) => Effect<T, NotFoundError | NetworkError>
}
const Http = makeTag<Http>()("Http")

// ---- business logic. no client passed around — each layer pulls it from context ----
const getUser = (id: number) =>
  flatMap(service(Http), (http) => http.get<User>(`/users/${id}`))

const getPosts = (userId: number) =>
  flatMap(service(Http), (http) => http.get<Post[]>(`/users/${userId}/posts`))

const getCommentCount = (postId: number) =>
  flatMap(service(Http), (http) =>
    map(http.get<unknown[]>(`/posts/${postId}/comments`), (comments) => comments.length))

const loadUserPosts = (userId: number) =>
  pipe(
    getUser(userId),
    flatMap((user) => getPosts(user.id)),
    flatMap((posts) =>
      // fetch every post's comment count at once, not one by one
      forEachConcurrent(posts, (post) =>
        map(getCommentCount(post.id), (comments): PostWithCount => ({ post, comments })))))

// ---- a fake in-memory client. swap it for a real `fetch` and nothing above changes ----
const DATA: Record<string, unknown> = {
  "/users/1": { id: 1, name: "Ada" } satisfies User,
  "/users/1/posts": [
    { id: 1, title: "On computation" },
    { id: 2, title: "On the Analytical Engine" },
  ] satisfies Post[],
  "/posts/1/comments": [{}, {}, {}], // 3 comments
  "/posts/2/comments": [{}],         // 1 comment
}

let glitches = 0 // one endpoint fails twice, so we can watch `retry` heal it

const HttpLive: Http = {
  get: <T>(url: string) =>
    pipe(
      flatMap(sleep(40), (): Effect<T, NotFoundError | NetworkError> => {
        if (url === "/posts/2/comments" && glitches < 2) {
          glitches++
          console.log(`  ↻ ${url} glitched (attempt ${glitches}) — retry will heal it`)
          return fail(network(`temporary glitch on ${url}`))
        }
        const body = DATA[url]
        return body === undefined ? fail(notFound(url)) : succeed(body as T)
      }),
      retry({ times: 3, while: (e) => e._tag === "Network" }) // retry network errors at the source
    ),
}

// ---- compose all of it, then run. nothing executes until runPromise. ----
// the annotation says "this has no remaining errors". that's what forces us to
// handle every case below: delete the `Timeout` handler and `TimeoutError` is
// left in the error channel, no longer matches `never`, and this stops compiling.
const program: Effect<PostWithCount[] | string, never, never> = pipe(
  loadUserPosts(1),
  timeout(2000),                                          // built-in; adds TimeoutError to the type
  tap((posts) => sync(() => console.log(`loaded ${posts.length} posts`))),
  // catchTags is the one combinator we left data-first (see 2.6), so we hand it `self` ourselves
  (self) => catchTags(self, {
    NotFound: (e) => sync(() => `not found: ${e.url}`),
    Network: (e) => sync(() => `network: ${e.message}`),
    Timeout: (e) => sync(() => `timed out after ${e.ms}ms`),
  }),
  provide(Http, HttpLive),                                // satisfy the dependency, here at the edge
)

runPromise(program).then((result) => console.log("result:", result))
