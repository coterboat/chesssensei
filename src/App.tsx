import { useState } from 'react'
import { useStore } from './state/store'
import { PlayScreen } from './ui/PlayScreen'
import { ReviewScreen } from './ui/ReviewScreen'
import { SettingsDrawer } from './ui/SettingsDrawer'

export default function App() {
  const opponent = useStore((s) => s.opponent)
  const botElo = useStore((s) => s.botElo)
  const screen = useStore((s) => s.screen)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const reviewId = useStore((s) => s.reviewId)
  const reviewPly = useStore((s) => s.reviewPly)
  const playerElo = useStore((s) => s.settings.playerElo)
  return (
    <div className="app">
      <header className="topbar">
        <img className="logo" src="/icon-192.png" alt="" width="26" height="26" />
        <span className="wordmark">Chess Sensei</span>
        <span className="elo-chips">
          <span className="elo-chip" title="Synthetic rating — not FIDE, not Chess.com">You {playerElo}</span>
          {opponent === 'engine' && <span className="elo-chip">Bot {botElo}</span>}
          <button className="elo-chip chip-btn" onClick={() => setSettingsOpen(true)}>Settings</button>
        </span>
      </header>
      {screen === 'review' ? <ReviewScreen key={`${reviewId}:${reviewPly}`} /> : <PlayScreen />}
      {settingsOpen && <SettingsDrawer onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
