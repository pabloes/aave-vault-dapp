import React, { useEffect, useState } from 'react'

export default function Countdown({ target }: { target: number }) {
  const [now, setNow] = useState<number>(Math.floor(Date.now() / 1000))

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  const remaining = Math.max(0, target - now)
  const days = Math.floor(remaining / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const mins = Math.floor((remaining % 3600) / 60)
  const secs = remaining % 60

  if (remaining === 0) return <span>Unlocked</span>

  return (
    <span>
      {days}d {hours}h {mins}m {secs}s
    </span>
  )
}
