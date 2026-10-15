import { useEffect, useState } from 'react'

/** Must match the `@media (max-width: 768px)` breakpoint in theme.css. */
export const MOBILE_QUERY = '(max-width: 768px)'

/** True below the mobile breakpoint; tracks window resizes / orientation changes. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false))
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = (e: MediaQueryListEvent): void => setMobile(e.matches)
    mq.addEventListener('change', onChange)
    setMobile(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}
