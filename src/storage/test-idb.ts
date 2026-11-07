/** Small transaction model for deterministic failure injection; not a browser proof. */
export function indexedDBModel(initial?: unknown) {
  let stored = structuredClone(initial)
  let failPut = false
  const keys = new Set(initial === undefined ? [] : ['current'])
  const factory = {
    open() {
      const request = { result: null as unknown, onsuccess: null as null | (() => void) }
      queueMicrotask(() => {
        request.result = {
          close() {},
          objectStoreNames: { contains: () => true },
          transaction() {
            let pending = 0
            let aborted = false
            let wrote = false
            let candidate = structuredClone(stored)
            const transaction = {
              oncomplete: null as null | (() => void), onabort: null as null | (() => void), onerror: null as null | (() => void),
              abort() {
                if (aborted) return
                aborted = true
                queueMicrotask(() => transaction.onabort?.())
              },
              objectStore() {
                return {
                  get(key: string) {
                    if (key !== 'current') throw new Error('unexpected key')
                    pending++
                    const read = { result: undefined as unknown, onsuccess: null as null | (() => void) }
                    queueMicrotask(() => {
                      if (aborted) return
                      read.result = structuredClone(candidate)
                      read.onsuccess?.()
                      pending--
                      complete()
                    })
                    return read
                  },
                  put(value: unknown, key: string) {
                    if (key !== 'current') throw new Error('unexpected key')
                    pending++
                    queueMicrotask(() => {
                      if (aborted) return
                      if (failPut) { failPut = false; transaction.abort(); return }
                      candidate = structuredClone(value)
                      wrote = true
                      pending--
                      complete()
                    })
                  },
                }
              },
            }
            function complete() {
              queueMicrotask(() => {
                if (aborted || pending !== 0) return
                if (wrote) { stored = structuredClone(candidate); keys.add('current') }
                transaction.oncomplete?.()
              })
            }
            return transaction
          },
        }
        request.onsuccess?.()
      })
      return request
    },
  }
  return {
    factory: factory as unknown as IDBFactory,
    read: () => structuredClone(stored), keys: () => [...keys],
    failNextPut: () => { failPut = true },
  }
}
