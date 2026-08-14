import type { LeagueApi } from '../../preload'

declare global {
  interface Window {
    league: LeagueApi
  }
}

export const api = window.league
