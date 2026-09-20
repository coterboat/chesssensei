import { useStore } from './state/store'
import { PlayScreen } from './ui/PlayScreen'
import { ReviewScreen } from './ui/ReviewScreen'

export default function App() {
  const opponent = useStore((s) => s.opponent)
  const botElo = useStore((s) => s.botElo)
  const screen = useStore((s) => s.screen)
  const reviewId = useStore((s) => s.reviewId)
  const reviewPly = useStore((s) => s.reviewPly)
  const playerElo = useStore((s) => s.settings.playerElo)
  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">Chess Sensei</span>
        <span className="elo-chips">
          <span className="elo-chip" title="Synthetic rating — not FIDE, not Chess.com">You {playerElo}</span>
          {opponent === 'engine' && <span className="elo-chip">Bot {botElo}</span>}
        </span>
      </header>
      {screen === 'review' ? <ReviewScreen key={`${reviewId}:${reviewPly}`} /> : <PlayScreen />}
    </div>
  )
}
