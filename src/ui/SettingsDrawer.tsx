import { exportBackup, importBackup } from '../persist/backup'
import { BOT_OFFSETS, type BotOffset } from '../review/adaptive'
import { useStore } from '../state/store'
import { playSound } from './sound'

export function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const resetRating = useStore((s) => s.resetRating)
  const history = settings.ratingHistory
  const setToast = useStore((s) => s.setToast)

  const download = async () => {
    const url = URL.createObjectURL(new Blob([await exportBackup()], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `chess-sensei-backup-${new Date().toLocaleDateString('sv')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const restore = async (file: File | undefined) => {
    if (!file) return
    if (!confirm('Restoring replaces ALL games, drill cards, settings and your rating in this window. Continue?')) return
    try {
      const { games, cards } = await importBackup(await file.text())
      alert(`Restored ${games} games and ${cards} drill cards. The app will reload.`)
      location.reload()
    } catch (err) {
      setToast(`Restore failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>Settings</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </header>

        <label className="setting">
          <span>
            Sounds
            <small>Move, capture, check and game-end sounds</small>
          </span>
          <input
            type="checkbox"
            checked={settings.sound}
            onChange={(e) => {
              update({ sound: e.target.checked })
              if (e.target.checked) playSound('move')
            }}
          />
        </label>

        <label className="setting">
          <span>
            AI coach notes
            <small>A short Grok-written explanation on key moves in reviews. Runs through the grok CLI on this Mac; only works in the Dock app (or with <code>npm run serve</code> running).</small>
          </span>
          <input type="checkbox" checked={settings.coach} onChange={(e) => update({ coach: e.target.checked })} />
        </label>

        <label className="setting">
          <span>
            Adaptive bot offset
            <small>How far above your rating the adaptive bot plays</small>
          </span>
          <select value={settings.botOffset} onChange={(e) => update({ botOffset: Number(e.target.value) as BotOffset })}>
            {BOT_OFFSETS.map((o) => (
              <option key={o} value={o}>+{o}</option>
            ))}
          </select>
        </label>

        <div className="setting">
          <span>
            Your rating: {settings.playerElo}
            <small>
              {settings.gamesPlayed} rated {settings.gamesPlayed === 1 ? 'game' : 'games'} · synthetic, not FIDE or Chess.com
            </small>
          </span>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('Reset your rating to the starting value? Saved games are kept.')) resetRating()
            }}
          >
            Reset
          </button>
        </div>

        {history.length > 1 && <Sparkline values={history.map((h) => h.elo)} />}

        <div className="setting">
          <span>
            Backup
            <small>Move your games, deck and rating between the Dock app and the dev server, or keep a copy</small>
          </span>
          <span className="backup-actions">
            <button className="btn" onClick={() => void download()}>Export</button>
            <label className="btn">
              Restore
              <input type="file" accept="application/json,.json" hidden onChange={(e) => void restore(e.target.files?.[0])} />
            </label>
          </span>
        </div>

        <p className="drawer-empty">
          Everything is stored in this browser only. Stockfish and Chessground are GPL-3; so is this app.
        </p>
      </aside>
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = Math.max(hi - lo, 1)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - lo) / span) * 28 - 1}`).join(' ')
  return (
    <div className="sparkline">
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="Rating history">
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <small>{lo} – {hi} over {values.length} games</small>
    </div>
  )
}
