import { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, copyFileSync } from 'fs'
import { loadData, saveData, dataFilePath } from './store'
import { importWorkbook } from '../shared/importXlsx'
import type { LeagueData } from '../shared/types'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: '#14100c',
    title: 'PKH League',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const query: Record<string, string> = {}
  if (process.env.PKH_SHOT_SCREEN) query.screen = process.env.PKH_SHOT_SCREEN
  if (process.env.PKH_SHOT_SHARECARD) query.sharecard = '1'
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    win.loadURL(url.toString())
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), Object.keys(query).length ? { query } : undefined)
  }

  // Dev harness: PKH_SHOT=<path> captures the window to a PNG and quits.
  if (process.env.PKH_SHOT) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        const scroll = Number(process.env.PKH_SHOT_SCROLL ?? 0)
        if (scroll > 0) {
          await win.webContents.executeJavaScript(
            `document.querySelector('.main').scrollTop = ${scroll}`
          )
          await new Promise((r) => setTimeout(r, 300))
        }
        if (process.env.PKH_TEST_COPY) {
          await win.webContents.executeJavaScript(
            `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Copy image').click()`
          )
          await new Promise((r) => setTimeout(r, 4000))
          const img = clipboard.readImage()
          console.log(
            img.isEmpty()
              ? 'PKH_TEST_COPY: FAILED — clipboard empty'
              : `PKH_TEST_COPY: OK — clipboard image ${img.getSize().width}x${img.getSize().height}`
          )
        }
        const img = await win.webContents.capturePage()
        writeFileSync(process.env.PKH_SHOT!, img.toPNG())
        app.quit()
      }, 1800)
    })
  }
}

app.whenReady().then(() => {
  ipcMain.handle('data:load', () => loadData())

  ipcMain.handle('data:save', (_e, data: LeagueData) => {
    saveData(data)
    return true
  })

  ipcMain.handle('data:exportFile', async (_e, data: LeagueData) => {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export league data',
      defaultPath: `pkh-league-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!filePath) return null
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return filePath
  })

  ipcMain.handle('data:importFile', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      title: 'Import league data (JSON backup)',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (!filePaths.length) return null
    const parsed = JSON.parse(readFileSync(filePaths[0], 'utf-8')) as LeagueData
    if (parsed.version !== 1 || !Array.isArray(parsed.seasons)) {
      throw new Error('Not a valid PKH League data file')
    }
    return parsed
  })

  ipcMain.handle('xlsx:import', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      title: 'Import from Excel',
      filters: [{ name: 'Excel workbook', extensions: ['xlsx', 'xlsm'] }],
      properties: ['openFile']
    })
    if (!filePaths.length) return null
    return importWorkbook(new Uint8Array(readFileSync(filePaths[0])))
  })

  ipcMain.handle('png:save', async (_e, dataUrl: string, suggestedName: string) => {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Save image',
      defaultPath: suggestedName,
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    })
    if (!filePath) return null
    writeFileSync(filePath, Buffer.from(dataUrl.split(',')[1], 'base64'))
    return filePath
  })

  ipcMain.handle('png:copy', (_e, dataUrl: string) => {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
    return true
  })

  ipcMain.handle('data:filePath', () => dataFilePath())

  ipcMain.handle('data:revealFile', () => {
    shell.showItemInFolder(dataFilePath())
    return true
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
