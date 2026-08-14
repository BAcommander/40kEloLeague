import { contextBridge, ipcRenderer } from 'electron'
import type { LeagueData } from '../shared/types'
import type { ImportResult } from '../shared/importXlsx'

export interface LeagueApi {
  loadData: () => Promise<LeagueData>
  saveData: (data: LeagueData) => Promise<boolean>
  exportFile: (data: LeagueData) => Promise<string | null>
  importFile: () => Promise<LeagueData | null>
  importXlsx: () => Promise<ImportResult | null>
  savePng: (dataUrl: string, suggestedName: string) => Promise<string | null>
  copyPng: (dataUrl: string) => Promise<boolean>
  dataFilePath: () => Promise<string>
  revealDataFile: () => Promise<boolean>
}

const api: LeagueApi = {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  exportFile: (data) => ipcRenderer.invoke('data:exportFile', data),
  importFile: () => ipcRenderer.invoke('data:importFile'),
  importXlsx: () => ipcRenderer.invoke('xlsx:import'),
  savePng: (dataUrl, suggestedName) => ipcRenderer.invoke('png:save', dataUrl, suggestedName),
  copyPng: (dataUrl) => ipcRenderer.invoke('png:copy', dataUrl),
  dataFilePath: () => ipcRenderer.invoke('data:filePath'),
  revealDataFile: () => ipcRenderer.invoke('data:revealFile')
}

contextBridge.exposeInMainWorld('league', api)
