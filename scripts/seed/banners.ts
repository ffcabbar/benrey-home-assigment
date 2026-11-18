import sharp from 'sharp'

const PALETTES: Array<[string, string]> = [
  ['#1e3a8a', '#3b82f6'],
  ['#065f46', '#10b981'],
  ['#7c2d12', '#f97316'],
  ['#581c87', '#a855f7'],
  ['#831843', '#ec4899'],
  ['#0f172a', '#64748b'],
  ['#134e4a', '#2dd4bf'],
  ['#713f12', '#eab308'],
]

export const BANNER_COUNT = PALETTES.length

export async function makeBanner(index: number, label: string): Promise<Buffer> {
  const [from, to] = PALETTES[index % PALETTES.length]
  const safe = label.replace(/[<>&"']/g, '')
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="400" fill="url(#g)"/>
  <circle cx="${980 - index * 40}" cy="${90 + index * 25}" r="${140 + index * 10}" fill="#ffffff" fill-opacity="0.08"/>
  <circle cx="${180 + index * 60}" cy="360" r="120" fill="#ffffff" fill-opacity="0.06"/>
  <text x="64" y="230" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="700" fill="#ffffff">${safe}</text>
</svg>`
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer()
}
