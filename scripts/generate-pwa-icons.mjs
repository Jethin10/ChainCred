// Pixel-native app icons, matching web/public/favicon.svg. No image dependency needed.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
const output = new URL('../web/public/icons/', import.meta.url)
mkdirSync(output, { recursive: true })
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, bytes) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])))
  return Buffer.concat([length, name, bytes, crc])
}
function icon(size, maskable = false) {
  const pixels = Buffer.alloc(size * (size * 3 + 1)), cell = Math.floor(size * .6 / 8), offset = Math.floor((size - cell * 8) / 2)
  const rows = ['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..']
  const blue = new Set(['3,2', '4,2', '3,3', '4,3', '5,3', '3,4', '4,4', '3,5'])
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const col = Math.floor((x - offset) / cell), row = Math.floor((y - offset) / cell)
    let color = maskable ? [124, 207, 255] : [243, 249, 255]
    if (rows[row]?.[col] === '#') color = blue.has(`${col},${row}`) ? [124, 207, 255] : [10, 10, 10]
    const i = y * (size * 3 + 1) + 1 + x * 3
    for (let c = 0; c < 3; c++) pixels[i + c] = color[c]
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
for (const size of [192, 512]) writeFileSync(new URL(`icon-${size}.png`, output), icon(size))
writeFileSync(new URL('maskable-512.png', output), icon(512, true))
writeFileSync(new URL('apple-touch-icon.png', output), icon(180))
console.log('Generated PayKit app icons')
