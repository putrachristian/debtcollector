import { useCallback, useEffect, useState } from 'react'

type DeferredInstall = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches
  )
}

function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/**
 * Chromium: capture `beforeinstallprompt` and call `install()` to show the system install sheet.
 * iOS: no programmatic install — show Share → Add to Home Screen instructions instead.
 */
export function usePwaInstall() {
  const [deferred, setDeferred] = useState<DeferredInstall | null>(null)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)')
    const onChange = () => setInstalled(isStandalone())
    onChange()
    mq.addEventListener('change', onChange)

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as DeferredInstall)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
    }
  }, [])

  const install = useCallback(async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
  }, [deferred])

  const canPromptInstall = Boolean(deferred) && !installed
  /** iOS (any browser) has no `beforeinstallprompt`; user installs via Share → Add to Home Screen. */
  const showIosHint = isIos() && !installed && !canPromptInstall

  return { canPromptInstall, showIosHint, install, installed }
}
