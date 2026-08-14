// One-off: renders build/icon.html to build/icon.png (256x256) using Electron.
// Run: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('fs')
const { join } = require('path')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true
  })
  await win.loadFile(join(__dirname, '../build/icon.html'))
  await new Promise((r) => setTimeout(r, 600))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 })
  writeFileSync(join(__dirname, '../build/icon.png'), img.toPNG())
  console.log('icon written', img.getSize())
  app.quit()
})
