const succeed = (value) => ({ _tag: "Succeed", value })
const map = (self, f) => ({ _tag: "Map", self, f })
const flatMap = (self, f) => ({ _tag: "FlatMap", self, f })
const sync = (thunk) => ({ _tag: "Sync", thunk })

const program = flatMap(
  succeed(1),
  (x) => map(
    succeed(2),
    (y) => x + y
  )
)

const run = (effect) => {
  switch (effect._tag) {
    case "Succeed":
      return effect.value
    case "Map":
      return effect.f(run(effect.self))
    case "FlatMap":
      return run(effect.f(run(effect.self)))
    case "Sync":
      return effect.thunk()
  }
}
