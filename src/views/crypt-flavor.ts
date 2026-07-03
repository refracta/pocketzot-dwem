// Flavor text for the crypt/sepulcher/thing
export const CRYPT_LINES: string[] = [
  'GAZE UPON THE EXALTED, THE AMBITIOUS, THE DISGRACED',
  'DISTURB NOT THEIR HALLOWED REPOSE',
  'MEDITATE UPON THY TRIUMPHS',
  'CONTEMPLATE THY TRIBULATIONS',
]

export function pickCryptLine(): string {
  if (CRYPT_LINES.length === 0) return ''
  return CRYPT_LINES[Math.floor(Math.random() * CRYPT_LINES.length)]
}
