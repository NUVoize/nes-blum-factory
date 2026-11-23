// Electron main for `npm run gift`: prints an HTML file to PDF (Letter, CSS @page margins).
// Usage: electron scripts/print-pdf.cjs <in.html> <out.pdf>
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

const [input, output] = process.argv.slice(-2);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    await win.loadURL(pathToFileURL(input).href);
    const pdf = await win.webContents.printToPDF({ pageSize: 'Letter', printBackground: true, preferCSSPageSize: true });
    writeFileSync(output, pdf);
    app.exit(0);
  } catch (e) {
    console.error(String(e));
    app.exit(1);
  }
});
