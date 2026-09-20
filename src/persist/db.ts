import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Color, GameStatus, PlyRecord } from '../chess/gameController'
import type { GameAnalysis, PositionEval } from '../review/types'

export interface GameRecord {
  id: string
  createdAt: number
  playerColor: Color
  botElo: number
  playerEloBefore: number
  playerEloAfter: number
  rated: boolean
  unratedReason?: string
  timeControl: string
  result: NonNullable<GameStatus['result']>
  termination: NonNullable<GameStatus['termination']>
  startFen: string
  pgn: string
  plies: PlyRecord[]
  analysisComplete: boolean
  /** Per-position engine evals (plies.length + 1). Filled progressively so analysis can resume. */
  evals?: (PositionEval | null)[]
  analysis?: GameAnalysis
  /** Rating adjustment for quality of play, applied once when analysis finished. */
  qualityDelta?: number
  /** Set on a retry: the game and ply it branched from. Retries are hidden from History. */
  parentId?: string
  parentPly?: number
  /** Set on games imported from PGN: the names from its headers. */
  imported?: { white: string; black: string }
}

interface Schema extends DBSchema {
  games: { key: string; value: GameRecord; indexes: { createdAt: number } }
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null

function db() {
  dbPromise ??= openDB<Schema>('chesssensei', 1, {
    upgrade(d) {
      d.createObjectStore('games', { keyPath: 'id' }).createIndex('createdAt', 'createdAt')
    },
  })
  return dbPromise
}

export async function saveGame(game: GameRecord): Promise<void> {
  await (await db()).put('games', game)
}

/** Newest first. */
export async function listGames(): Promise<GameRecord[]> {
  return (await (await db()).getAllFromIndex('games', 'createdAt')).reverse()
}

export async function getGame(id: string): Promise<GameRecord | undefined> {
  return (await db()).get('games', id)
}

/** Deletes a game and any retries that branched from it. */
export async function deleteGame(id: string): Promise<void> {
  const d = await db()
  const all = await d.getAll('games')
  await Promise.all([id, ...all.filter((g) => g.parentId === id).map((g) => g.id)].map((k) => d.delete('games', k)))
}

export async function deleteAllGames(): Promise<void> {
  await (await db()).clear('games')
}
