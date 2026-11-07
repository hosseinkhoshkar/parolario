import type { OfflineStatus } from '../contracts/index.ts'
import { isVerifiedCacheMessage } from './cache-proof.ts'

let registration: Promise<ServiceWorkerRegistration> | null = null

export async function prepareOffline(): Promise<OfflineStatus> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return 'unavailable'
  try {
    registration ??= navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
    await registration
    let timeout: number | undefined
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error('Offline install timed out')), 10_000) }),
    ]).finally(() => window.clearTimeout(timeout))
    const worker = navigator.serviceWorker.controller ?? ready.active
    if (!worker) return 'unavailable'
    return await new Promise<OfflineStatus>(resolve => {
      const channel = new MessageChannel()
      const timer = window.setTimeout(() => { channel.port1.close(); resolve('unavailable') }, 8000)
      channel.port1.onmessage = event => {
        window.clearTimeout(timer)
        channel.port1.close()
        resolve(isVerifiedCacheMessage(event.data, import.meta.env.VITE_WORTZEIT_BUILD_ID) ? 'ready' : 'unavailable')
      }
      worker.postMessage({ type: 'VERIFY_CACHE' }, [channel.port2])
    })
  } catch { registration = null; return 'unavailable' }
}
