import { useState } from 'react'
import type { GameRecord } from '../persist/db'
import { useStore } from '../state/store'

function outcome(g: GameRecord): { label: string; cls: string } {
  if (g.result === '1/2-1/2') return { label: 'Draw', cls: 'draw' }
  const won = (g.result === '1-0') === (g.playerColor === 'w')
  return won ? { label: 'Win', cls: 'win' } : { label: 'Loss', cls: 'loss' }
}

const DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const allGames = useStore((s) => s.savedGames)
  const games = allGames.filter((g) => !g.parentId) // retries live under their parent game
  const reviewId = useStore((s) => s.reviewId)
  const openReview = useStore((s) => s.openReview)
  const removeGame = useStore((s) => s.removeGame)
  const removeAllGames = useStore((s) => s.removeAllGames)
  const importPgn = useStore((s) => s.importPgn)
  const [importing, setImporting] = useState(false)
  const [pgn, setPgn] = useState('')
  const [error, setError] = useState<string | null>(null)

  const runImport = async (color: 'w' | 'b') => {
    try {
      await importPgn(pgn, color)
      onClose()
    } catch (err) {
      setError(`Couldn't read that PGN: ${(err as Error).message}`)
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label="Game history" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>History</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </header>

        {games.length === 0 ? (
          <p className="drawer-empty">No games yet. Finish a game against the bot and it shows up here.</p>
        ) : (
          <ul className="game-list">
            {games.map((g) => {
              const o = outcome(g)
              const delta = g.playerEloAfter - g.playerEloBefore
              const moves = Math.ceil(g.plies.length / 2)
              return (
                <li key={g.id} className={g.id === reviewId ? 'open' : ''}>
                  <button
                    className="game-row"
                    onClick={() => {
                      openReview(g.id)
                      onClose()
                    }}
                  >
                    <span className={`result ${o.cls}`}>{o.label}</span>
                    <span className="game-main">
                      {g.imported
                        ? `${g.imported.white} – ${g.imported.black}`
                        : `${g.playerColor === 'w' ? 'White' : 'Black'} vs Bot ${g.botElo}`}
                      <small>
                        {DATE.format(g.createdAt)} · {moves} {moves === 1 ? 'move' : 'moves'} · {g.termination}
                      </small>
                    </span>
                    <span className="game-elo">
                      {g.analysis ? `${g.analysis.accuracy[g.playerColor].toFixed(0)}%` : '…'}
                      <small>{g.rated ? `${delta >= 0 ? '+' : ''}${delta}` : 'unrated'}</small>
                    </span>
                  </button>
                  <button className="game-del" aria-label="Delete game" title="Delete game" onClick={() => void removeGame(g.id)}>
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {importing ? (
          <div className="import-box">
            <textarea
              value={pgn}
              onChange={(e) => {
                setPgn(e.target.value)
                setError(null)
              }}
              placeholder="Paste a PGN here (e.g. exported from Chess.com or Lichess)…"
              rows={7}
            />
            {error && <p className="import-error">{error}</p>}
            <div className="import-actions">
              <button className="btn primary" disabled={!pgn.trim()} onClick={() => void runImport('w')}>I was White</button>
              <button className="btn primary" disabled={!pgn.trim()} onClick={() => void runImport('b')}>I was Black</button>
              <button className="btn" onClick={() => setImporting(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn" onClick={() => setImporting(true)}>Import PGN for review</button>
        )}

        {games.length > 0 && (
          <button
            className="btn danger"
            onClick={() => {
              if (confirm(`Delete all ${games.length} saved games? Your rating is kept.`)) void removeAllGames()
            }}
          >
            Delete all
          </button>
        )}
      </aside>
    </div>
  )
}
