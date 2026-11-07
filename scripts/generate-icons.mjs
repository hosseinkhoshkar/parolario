import { deflateSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4)
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([size, name, data, crc])
}
function distance(x, y, a, b) {
  const t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)))
  return Math.hypot(x - a[0] - t * (b[0] - a[0]), y - a[1] - t * (b[1] - a[1]))
}
for (const size of [192, 512]) {
  const raw = Buffer.alloc((size * 4 + 1) * size), points = [[39, 65], [62, 132], [96, 79], [130, 132], [151, 76]]
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x * 192 / size, py = y * 192 / size
    let color = [36, 89, 75, 255]
    if (Math.hypot(px - 140, py - 49) <= 13) color = [249, 198, 109, 255]
    if (points.slice(1).some((point, i) => distance(px, py, points[i], point) <= 7)) color = [255, 248, 233, 255]
    raw.set(color, y * (size * 4 + 1) + 1 + x * 4)
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6
  await writeFile(`public/icon-${size}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}
