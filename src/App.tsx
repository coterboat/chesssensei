import { useStore } from './state/store'
import { PlayScreen } from './ui/PlayScreen'

export default function App() {
  const opponent = useStore((s) => s.opponent)
  const botElo = useStore((s) => s.botElo)
  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">Chess Sensei</span>
        {opponent === 'engine' && <span className="elo-chip">Bot {botElo}</span>}
      </header>
      <PlayScreen />
    </div>
  )
}
