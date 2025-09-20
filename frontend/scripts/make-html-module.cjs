const fs = require('fs')
const path = require('path')

const distHtml = path.join(__dirname, '..', 'dist', 'index.html')
const outJs = path.join(__dirname, '..', 'dist', 'aave-vault-html.js')

const html = fs.readFileSync(distHtml, 'utf8')
const escaped = html
  .replace(/`/g, '\\`')
  .replace(/\\/g, '\\\\')

const js = `export const AAVE_VAULT_HTML = \`${escaped}\`\nexport default AAVE_VAULT_HTML\n`
fs.writeFileSync(outJs, js)
console.log('Wrote', outJs)


