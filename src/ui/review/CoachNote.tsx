import { useEffect, useState } from 'react'
import type { GameRecord } from '../../persist/db'
import { COACHED, coachAvailable, fetchCoachNote } from '../../review/coach'
import { useStore } from '../../state/store'

// Requests are debounced so holding → through a game doesn't launch a CLI call per move.
const DEBOUNCE_MS = 500

/** The generated note for one move: cached text, or fetched (once) when the move stays selected. */
export function CoachNote({ record, ply }: { record: GameRecord; ply: number }) {
  const enabled = useStore((s) => s.settings.coach)
  const saveCoachNote = useStore((s) => s.saveCoachNote)
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')

  const move = record.analysis?.moves[ply - 1]
  const cached = record.coachNotes?.[ply]
  const wanted = enabled && move !== undefined && COACHED.has(move.classification) && !cached

  useEffect(() => {
    setState('idle')
    if (!wanted) return
    const abort = new AbortController()
    const timer = setTimeout(async () => {
      if (!(await coachAvailable()) || abort.signal.aborted) return
      setState('loading')
      try {
        const text = await fetchCoachNote(record, ply, abort.signal)
        await saveCoachNote(record.id, ply, text)
      } catch {
        if (!abort.signal.aborted) setState('failed')
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [wanted, record.id, ply]) // eslint-disable-line react-hooks/exhaustive-deps

  if (cached) {
    return (
      <p className="coach-note">
        <span>Coach</span>
        {cached}
      </p>
    )
  }
  if (state === 'loading') return <p className="coach-note loading"><span>Coach</span>Grok is thinking…</p>
  if (state === 'failed') return <p className="coach-note loading"><span>Coach</span>Couldn't reach Grok for this one.</p>
  return null
}
