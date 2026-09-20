import type { Card } from '../drill/deck'
import { deleteAllGames, listCards, listGames, saveCards, saveGame, type GameRecord } from './db'
import { loadSettings, saveSettings, type Settings } from './settings'

// Browser storage is per-origin, so the dev server (:5173) and the Dock app (:5180) each have their
// own games and rating. A backup file is how data moves between them (and how it survives a wipe).

interface Backup {
  app: 'chesssensei'
  version: 1
  exportedAt: number
  settings: Settings
  games: GameRecord[]
  cards: Card[]
}

export async function exportBackup(): Promise<string> {
  const backup: Backup = {
    app: 'chesssensei',
    version: 1,
    exportedAt: Date.now(),
    settings: loadSettings(),
    games: await listGames(),
    cards: await listCards(),
  }
  return JSON.stringify(backup)
}

/** Replaces everything in this browser with the backup's contents. Returns how much was restored. */
export async function importBackup(json: string): Promise<{ games: number; cards: number }> {
  const data = JSON.parse(json) as Partial<Backup>
  if (data.app !== 'chesssensei' || !Array.isArray(data.games) || !data.settings) {
    throw new Error('not a Chess Sensei backup file')
  }
  await deleteAllGames()
  for (const g of data.games) await saveGame(g)
  await saveCards(data.cards ?? [])
  saveSettings(data.settings)
  return { games: data.games.length, cards: data.cards?.length ?? 0 }
}
