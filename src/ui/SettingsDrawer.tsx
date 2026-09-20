import { BOT_OFFSETS, type BotOffset } from '../review/adaptive'
import { useStore } from '../state/store'
import { playSound } from './sound'

export function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const resetRating = useStore((s) => s.resetRating)
  const history = settings.ratingHistory

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
