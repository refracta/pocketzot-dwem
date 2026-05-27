#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const html = readFileSync(resolve(root, 'index.html'), 'utf8')
const attrs = [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map((match) => match[1])

const optionalHostedPages = new Set(['/about.html', '/changelog.html', 'about.html', 'changelog.html'])
const missing = []

for (const attr of attrs) {
  if (shouldSkip(attr)) continue
  const path = localPathFor(attr)
  if (!existsSync(path)) missing.push(attr)
}

if (missing.length) {
  console.error(`Missing local HTML link target(s): ${missing.join(', ')}`)
  process.exit(1)
}

function shouldSkip(value) {
  return /^(?:https?:|mailto:|data:|#)/.test(value) || optionalHostedPages.has(value)
}

function localPathFor(value) {
  const attr = value.replace(/^%BASE_URL%/, '')
  const path = attr.replace(/^\/+/, '')

  if (path.startsWith('src/')) return resolve(root, path)
  if (attr.startsWith('/')) return resolve(root, `public/${path}`)

  const rootPath = resolve(root, path)
  if (existsSync(rootPath)) return rootPath
  return resolve(root, `public/${path}`)
}
