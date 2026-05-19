import type { PlayerMsg } from '../../ws/types'
import type { InventoryStore } from '../inventory-store'
import { escHtml, dcssToHtml, DCSS_COLOR_MAP } from '../dcss-colors'

const NOISE_WIDTH = 9
const BAR_RES = 10000  // basis points; matches reference player.js precision

function indexToLetter(index: number): string {
  if (index < 0) return '-'
  if (index < 26) return String.fromCharCode(0x61 + index)
  return String.fromCharCode(0x41 + index - 26)
}

function noiseColor(level: number): string {
  if (level <= 333) return DCSS_COLOR_MAP.lightgrey
  if (level <= 666) return DCSS_COLOR_MAP.yellow
  if (level < 1000) return DCSS_COLOR_MAP.red
  return DCSS_COLOR_MAP.lightmagenta
}

export class StatsView {
  private el: HTMLElement
  private state: Partial<PlayerMsg> = {}
  private inv: InventoryStore
  private prevTime: number | undefined
  private timeDelta = 0
  private prevNoiseSegs: number | undefined
  private oldHp: number | undefined
  private oldMp: number | undefined

  constructor(inv: InventoryStore) {
    this.inv = inv
    this.el = document.createElement('div')
    this.el.id = 'hud-stats'
    this.el.innerHTML = this.template()
  }

  get element(): HTMLElement {
    return this.el
  }

  update(p: Partial<PlayerMsg>): void {
    if ('time' in p && p.time !== undefined) {
      if (this.prevTime !== undefined) {
        this.timeDelta = p.time - this.prevTime
      }
      this.prevTime = p.time
    }
    Object.assign(this.state, p)
    this.render()
  }

  private render(): void {
    const s = this.state
    const hp = s.hp ?? 0
    const hpMax = s.hp_max ?? 1
    const mp = s.mp ?? 0
    const mpMax = s.mp_max ?? 1

    const name = s.name ?? ''
    const title = s.title ?? ''
    const species = s.species ?? ''
    const god = s.god ?? ''
    const piety = s.piety_rank ?? 0
    const godStr = god && god !== 'No God' ? ` of ${god}` : ''
    const nameTitle = name && title ? `${name} ${title}` : name || title
    const speciesGod = species + godStr
    const idLine = nameTitle && speciesGod ? `${nameTitle} — ${speciesGod}` : nameTitle || speciesGod
    this.setText('hud-id', idLine)

    const pietyEl = this.el.querySelector<HTMLElement>('#hud-piety')
    if (pietyEl) {
      const showPiety = god && god !== 'No God' && god !== 'Gozag'
      pietyEl.textContent = showPiety && piety > 0
        ? '*'.repeat(piety) + '.'.repeat(Math.max(0, 6 - piety))
        : ''
    }

    const realHpMax = s.real_hp_max
    const hpText = realHpMax != null && realHpMax !== hpMax
      ? `${hp}/${hpMax} (${realHpMax})`
      : `${hp}/${hpMax}`
    this.setText('hud-hp', hpText)

    // dd_real_mp_max is sent as 0 for non-Deep-Dwarves; only show parens for DD with reduced max.
    const ddRealMpMax = s.dd_real_mp_max ?? 0
    const mpText = ddRealMpMax > 0 && ddRealMpMax !== mpMax
      ? `${mp}/${mpMax} (${ddRealMpMax})`
      : `${mp}/${mpMax}`
    this.setText('hud-mp', mpText)

    this.renderStatValue('hud-str', s.str, this.statClass('str'))
    this.renderStatValue('hud-int', s.int, this.statClass('int'))
    this.renderStatValue('hud-dex', s.dex, this.statClass('dex'))

    this.renderDefenseValue('hud-ac', s.ac, s.ac_mod)
    this.renderDefenseValue('hud-ev', s.ev, s.ev_mod)
    this.renderDefenseValue('hud-sh', s.sh, s.sh_mod)

    const xl = s.xl ?? '?'
    const place = s.place ?? ''
    const depth = s.depth
    const placeStr = depth ? `${place}:${depth}` : place
    const xlEl = this.el.querySelector<HTMLElement>('#hud-xl-place')
    if (xlEl) {
      let html = `<span class="hg-caption">XL</span><span>${escHtml(String(xl))}</span>`
      if (s.progress != null) html += ` ${escHtml(String(s.progress))}%`
      if (placeStr) html += ` <span class="hg-caption">@</span><span>${escHtml(placeStr)}</span>`
      if (god === 'Gozag' && s.gold != null) {
        const aura = (s.status ?? []).some(st => st.text === 'gold aura')
        const valClass = aura ? ' class="stat-boosted"' : ''
        html += ` <span class="hg-caption">$</span><span${valClass}>${escHtml(String(s.gold))}</span>`
      }
      xlEl.innerHTML = html
    }

    const time = s.time ?? 0
    const timeStr = (time / 10).toFixed(1) + (this.timeDelta > 0 ? ` (${(this.timeDelta / 10).toFixed(1)})` : '')
    const timeEl = this.el.querySelector<HTMLElement>('#hud-time')
    if (timeEl) timeEl.innerHTML = `<span class="hg-caption">T</span><span>${escHtml(timeStr)}</span>`

    this.renderBar('hp', hp, hpMax, s.poison_survival)
    this.renderBar('mp', mp, mpMax, undefined)

    // Noise bar
    const noiseBar = this.el.querySelector<HTMLElement>('#hud-noise-bar')
    if (noiseBar) noiseBar.innerHTML = this.buildNoiseBar(s.adjusted_noise ?? 0)

    // Weapon row (own line, ellipsis if too long)
    const wqRow = this.el.querySelector<HTMLElement>('#hud-wq')
    const weaponHtml = this.buildWeapon()
    if (wqRow) {
      wqRow.innerHTML = weaponHtml
      wqRow.style.display = weaponHtml ? '' : 'none'
    }

    // Quiver gets its own row directly below the weapon (console-style pairing)
    const quiverEl = this.el.querySelector<HTMLElement>('#hud-quiver')
    if (quiverEl) {
      const quiverHtml = dcssToHtml(s.quiver_desc ?? '')
      quiverEl.innerHTML = quiverHtml
      quiverEl.style.display = quiverHtml ? '' : 'none'
    }
  }

  // Mirrors update_bar() in webserver/game_data/static/player.js:21-67. Segments are
  // sized in basis points and applied as percent widths to four (HP) or three (MP)
  // sibling spans inside .hg-bar-cell. decrease/increase only show on the tick when
  // the value changes; on the next render with no change, both go back to 0.
  private renderBar(
    name: 'hp' | 'mp',
    value: number,
    max: number,
    poisonSurvival: number | undefined,
  ): void {
    value = Math.max(0, value)
    max = Math.max(1, max)
    const prevOld = name === 'hp' ? this.oldHp : this.oldMp
    const oldValue = Math.min(prevOld ?? value, max)
    if (name === 'hp') this.oldHp = value
    else this.oldMp = value

    const increase = oldValue < value
    let fullBar = Math.round(((increase ? oldValue : value) / max) * BAR_RES)
    let changeBar = Math.floor((Math.abs(oldValue - value) / max) * BAR_RES)
    let poisonBar = 0

    if (name === 'hp' && poisonSurvival != null && poisonSurvival < value) {
      poisonBar = Math.round(((value - poisonSurvival) / max) * BAR_RES)
      fullBar = Math.round((poisonSurvival / max) * BAR_RES)
    }

    if (fullBar + poisonBar + changeBar > BAR_RES) {
      changeBar = Math.max(0, BAR_RES - poisonBar - fullBar)
    }

    this.setSegWidth(`${name}-full`, fullBar)
    if (name === 'hp') this.setSegWidth('hp-poison', poisonBar)
    this.setSegWidth(`${name}-decrease`, increase ? 0 : changeBar)
    this.setSegWidth(`${name}-increase`, increase ? changeBar : 0)
  }

  private setSegWidth(cls: string, basisPoints: number): void {
    const el = this.el.querySelector<HTMLElement>(`.${cls}`)
    if (el) el.style.width = `${basisPoints / 100}%`
  }

  private buildNoiseBar(level: number): string {
    const segs = Math.ceil((level * NOISE_WIDTH) / 1000)
    const prev = this.prevNoiseSegs ?? segs
    this.prevNoiseSegs = segs

    const col = noiseColor(level)
    let bar = ''
    for (let i = 0; i < NOISE_WIDTH; i++) {
      if (i < segs) {
        bar += `<span style="color:${col}">=</span>`
      } else if (i < prev) {
        // decrease indicator: dim dash in noise color for one frame
        bar += `<span style="color:${col}">-</span>`
      } else {
        bar += `<span class="noise-empty">-</span>`
      }
    }
    return bar
  }

  private buildWeapon(): string {
    const s = this.state
    const idx = s.weapon_index
    if (idx === undefined) return ''

    const corroded = (s.status ?? []).some(st => st.text === 'corroded')
    const classes: string[] = []

    let name: string
    let col: number | undefined
    if (idx === -1) {
      name = s.unarmed_attack ?? ''
      col = s.unarmed_attack_colour ?? 7
    } else {
      const item = this.inv.get(idx)
      if (!item) return ''
      name = item.name ?? ''
      col = item.col
    }
    // Reference omits the .fgN class when col is -1 or null (defaults to lightgrey).
    if (col != null && col >= 0) classes.push(`fg${col & 0xf}`)
    if (corroded) classes.push('weapon-corroded')

    const letter = idx === -1 ? '-' : indexToLetter(idx)
    const classAttr = classes.length ? ` class="${classes.join(' ')}"` : ''
    return `<span class="hg-caption">${letter})</span> <span${classAttr}>${escHtml(name)}</span>`
  }

  private statClass(stat: 'str' | 'int' | 'dex'): string {
    const statuses = this.state.status ?? []
    const lostRe = new RegExp(`lost ${stat}`, 'i')
    if (statuses.some(st => st.text && lostRe.test(st.text))) return 'stat-zero'
    if (statuses.some(st => st.text && /vitalised/i.test(st.text))) return 'stat-boosted'
    return ''
  }

  private renderStatValue(id: string, val: number | undefined, cls: string): void {
    const el = this.el.querySelector<HTMLElement>(`#${id}`)
    if (!el) return
    el.textContent = String(val ?? 0)
    el.classList.remove('stat-boosted', 'stat-zero')
    if (cls) el.classList.add(cls)
  }

  private renderDefenseValue(id: string, val: number | undefined, mod: number | undefined): void {
    const el = this.el.querySelector<HTMLElement>(`#${id}`)
    if (!el) return
    el.textContent = String(val ?? 0)
    el.classList.toggle('def-boosted', (mod ?? 0) > 0)
    el.classList.toggle('def-degenerated', (mod ?? 0) < 0)
  }

  private setText(id: string, text: string): void {
    const el = this.el.querySelector<HTMLElement>(`#${id}`)
    if (el) el.textContent = text
  }

  private template(): string {
    return `
      <div class="hs-id fg14"><span id="hud-id"></span><span class="hg-piety" id="hud-piety"></span></div>
      <div class="hg-bar-pair">
        <div class="hg-bar-row hg-hp">
          <div class="hg-bar-cell"><span class="hud-bar-seg hp-full"></span><span class="hud-bar-seg hp-poison"></span><span class="hud-bar-seg hp-decrease"></span><span class="hud-bar-seg hp-increase"></span></div>
          <span class="hg-bar-val" id="hud-hp"></span>
        </div>
        <div class="hg-bar-row hg-mp">
          <div class="hg-bar-cell"><span class="hud-bar-seg mp-full"></span><span class="hud-bar-seg mp-decrease"></span><span class="hud-bar-seg mp-increase"></span></div>
          <span class="hg-bar-val" id="hud-mp"></span>
        </div>
      </div>
      <div class="hg-stats-row">
        <div class="hg-inline-stats">
          <span class="hg-grp"><span class="hg-caption">AC</span><span id="hud-ac"></span> <span class="hg-caption">EV</span><span id="hud-ev"></span> <span class="hg-caption">SH</span><span id="hud-sh"></span></span>
          <span class="hg-grp"><span class="hg-caption">St</span><span id="hud-str"></span> <span class="hg-caption">In</span><span id="hud-int"></span> <span class="hg-caption">Dx</span><span id="hud-dex"></span></span>
        </div>
      </div>
      <div class="hg-xl-row">
        <span class="hg-xl-place hg-grp" id="hud-xl-place"></span>
        <span class="hg-noise-time">
          <span class="hg-noise"><span class="hg-caption">N</span><span id="hud-noise-bar"></span></span>
          <span class="hg-time" id="hud-time"></span>
        </span>
      </div>
      <div class="hg-wq" id="hud-wq"></div>
      <div class="hg-quiver" id="hud-quiver"></div>
    `
  }
}
