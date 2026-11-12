import { useEffect, useRef, useState } from 'react'
import { readRecoverySnapshot } from '../storage/index.ts'

/** Available before startup succeeds; downloads locally and never uploads progress. */
export function RecoveryBackup() {
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url) }, [download])

  const prepare = async () => {
    setBusy(true)
    setError(null)
    try {
      const snapshot = await readRecoverySnapshot()
      if (!mounted.current) return
      const exportedAt = new Date().toISOString()
      const blob = new Blob([JSON.stringify({ format: 'parolario-recovery-v1', exportedAt,
        build: document.querySelector('meta[name="parolario-build"]')?.getAttribute('content') ?? null,
        snapshot }, null, 2)], { type: 'application/json' })
      setDownload({ url: URL.createObjectURL(blob), filename: `parolario-progress-${exportedAt.slice(0, 10)}.json` })
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'آماده‌کردن پشتیبان ممکن نشد.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return <div className="recovery-backup">
    <p>برای بررسی و بازیابی، یک کپی از پیشرفت همین دستگاه دریافت کنید. داده‌های ذخیره‌شده تغییر نمی‌کنند و فایل خودکار برای کسی ارسال نمی‌شود.</p>
    {download
      ? <a href={download.url} download={download.filename}>ذخیرهٔ فایل پشتیبان</a>
      : <button type="button" disabled={busy} onClick={() => { void prepare() }}>
        {busy ? 'در حال آماده‌کردن پشتیبان…' : 'دریافت پشتیبان پیشرفت'}
      </button>}
    {error && <p role="alert">{error}</p>}
  </div>
}
