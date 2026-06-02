// ============================================================
// THE TASK (plain TypeScript, no Effect)
//
// 1. fetch a user by id
// 2. fetch that user's posts
// 3. for each post, fetch its comment count (CONCURRENTLY)
// 4. retry any failed network call up to 3 times
// 5. time the whole thing out after 2 seconds
// 6. keep errors typed and distinguishable
// 7. keep the HTTP client swappable (for tests)
// ============================================================

// ---- types ----
interface User { id: number; name: string }
interface Post { id: number; title: string }
interface PostWithCount { post: Post; comments: number }

// our "typed errors" — we have to hand-roll these as classes
class NotFoundError extends Error { readonly _tag = "NotFound" }
class NetworkError extends Error { readonly _tag = "Network" }
class TimeoutError extends Error { readonly _tag = "Timeout" }

// ---- the swappable HTTP client: passed by hand as an argument ----
interface HttpClient {
  get<T>(url: string): Promise<T>
}

// ---- retry: hand-written loop ----
async function withRetry<T>(fn: () => Promise<T>, times: number): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= times; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      // only retry network errors, not 404s — we have to check by hand
      if (!(err instanceof NetworkError)) throw err
    }
  }
  throw lastErr
}

// ---- timeout: race against a sleeping promise ----
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new TimeoutError(`timed out after ${ms}ms`)), ms)
    ),
  ])
}

// ---- the actual logic ----
async function getUser(http: HttpClient, id: number): Promise<User> {
  return withRetry(() => http.get<User>(`/users/${id}`), 3)
}

async function getPosts(http: HttpClient, userId: number): Promise<Post[]> {
  return withRetry(() => http.get<Post[]>(`/users/${userId}/posts`), 3)
}

async function getCommentCount(http: HttpClient, postId: number): Promise<number> {
  const comments = await withRetry(
    () => http.get<unknown[]>(`/posts/${postId}/comments`),
    3
  )
  return comments.length
}

async function loadUserPosts(
  http: HttpClient,
  userId: number
): Promise<PostWithCount[]> {
  const user = await getUser(http, userId)
  const posts = await getPosts(http, user.id)

  // concurrency: Promise.all, and remember to map errors ourselves
  const withCounts = await Promise.all(
    posts.map(async (post) => {
      const comments = await getCommentCount(http, post.id)
      return { post, comments }
    })
  )
  return withCounts
}

// ---- run it, wiring timeout + error handling by hand ----
async function main() {
  // we have to construct and thread the client through everything
  const http: HttpClient = {
    async get<T>(url: string): Promise<T> {
      const res = await fetch(`https://jsonplaceholder.typicode.com${url}`)
        .catch(() => { throw new NetworkError(`failed to reach ${url}`) })
      if (res.status === 404) throw new NotFoundError(url)
      if (!res.ok) throw new NetworkError(`bad status ${res.status} for ${url}`)
      return res.json() as Promise<T>
    },
  }

  try {
    const result = await withTimeout(loadUserPosts(http, 1), 2000)
    console.log(`loaded ${result.length} posts`)
    for (const { post, comments } of result.slice(0, 3)) {
      console.log(`- "${post.title.slice(0, 30)}..." (${comments} comments)`)
    }
  } catch (err) {
    // errors are 'unknown' — we have to narrow by hand, and it's easy
    // to forget a case. nothing forced us to handle all of them.
    if (err instanceof NotFoundError) console.error("not found:", err.message)
    else if (err instanceof NetworkError) console.error("network:", err.message)
    else if (err instanceof TimeoutError) console.error("timeout:", err.message)
    else console.error("unknown error:", err)
  }
}

main()
