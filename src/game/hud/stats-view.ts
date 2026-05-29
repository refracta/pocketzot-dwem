import type { PlayerMsg } from '../../ws/types'
import type { InventoryStore } from '../inventory-store'
import { escHtml, dcssToHtml } from '../dcss-colors'

const BAR_RES = 10000  // basis points; matches reference player.js precision

function indexToLetter(index: number): string {
  if (index < 0) return '-'
  if (index < 26) return String.fromCharCode(0x61 + index)
  return String.fromCharCode(0x41 + index - 26)
}

// Noise level → data-level category, mirroring update_bar_noise in player.js.
// The matching colors live in style.css (.hg-noise-cell[data-level=...]).
function noiseCat(level: number): string {
  if (level <= 333) return 'quiet'
  if (level <= 666) return 'loud'
  if (level < 1000) return 'veryloud'
  return 'superloud'
}

export class StatsView {
  private el: HTMLElement
  private state: Partial<PlayerMsg> = {}
  private inv: InventoryStore
  private prevTime: number | undefined
  private timeDelta = 0
  private oldNoise: number | undefined
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

    // Tint the HP/MP figure "boosted" (lightblue) while the relevant max is
    // magically inflated, mirroring player.js stat_boosters: HP under divinely
    // vigorous or berserk, MP under divinely vigorous. (The bar itself is
    // unchanged — this is only the numeric readout, as in the reference.)
    const statuses = s.status ?? []
    const hasStatus = (re: RegExp): boolean => statuses.some(st => st.text != null && re.test(st.text))
    this.el.querySelector('#hud-hp')?.classList.toggle('stat-boosted', hasStatus(/divinely vigorous|berserk/i))
    this.el.querySelector('#hud-mp')?.classList.toggle('stat-boosted', hasStatus(/divinely vigorous/i))

    this.renderStatValue('hud-str', s.str, s.str_max, 'str')
    this.renderStatValue('hud-int', s.int, s.int_max, 'int')
    this.renderStatValue('hud-dex', s.dex, s.dex_max, 'dex')

    this.renderDefenseValue('hud-ac', s.ac, s.ac_mod)
    this.renderDefenseValue('hud-ev', s.ev, s.ev_mod)
    this.renderDefenseValue('hud-sh', s.sh, s.sh_mod)

    this.renderWarnings()

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

    // Noise bar (graphical, mirrors update_bar_noise in player.js)
    this.renderNoiseBar(s.adjusted_noise ?? 0, hasStatus(/silenced?/i))

    // Weapon row (own line, ellipsis if too long)
    const wqRow = this.el.querySelector<HTMLElement>('#hud-wq')
    const weaponHtml = this.buildWeapon(false)
    if (wqRow) {
      wqRow.innerHTML = weaponHtml
      wqRow.style.display = weaponHtml ? '' : 'none'
    }

    // Offhand weapon row (dual-wield etc.) — only when server flags it.
    const offhandRow = this.el.querySelector<HTMLElement>('#hud-wq-offhand')
    if (offhandRow) {
      const offhandHtml = s.offhand_weapon ? this.buildWeapon(true) : ''
      offhandRow.innerHTML = offhandHtml
      offhandRow.style.display = offhandHtml ? '' : 'none'
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

  // Mirrors update_bar_noise() in player.js:69-139. adjusted_noise is already
  // rescaled server-side to 0–1000. The full segment is colored by level via a
  // data-level attribute (see style.css); the decrease segment shows the
  // receding tail in darkgray for one tick when noise drops. When silenced the
  // bar blanks to black and the caption reads "Silenced".
  private renderNoiseBar(level: number, silenced: boolean): void {
    const max = 1000
    if (level < 0) level = 0
    let oldValue = Math.min(this.oldNoise ?? level, max)
    let cat = noiseCat(level)
    if (silenced) {
      level = 0
      oldValue = 0
      cat = 'blank'
    }
    this.oldNoise = level

    const fullBar = Math.round((BAR_RES * level) / max)
    let changeBar = Math.round((BAR_RES * Math.abs(oldValue - level)) / max)
    if (fullBar + changeBar > BAR_RES) changeBar = BAR_RES - fullBar

    const cell = this.el.querySelector<HTMLElement>('#hud-noise-cell')
    if (cell) cell.setAttribute('data-level', cat)
    this.setSegWidth('noise-full', fullBar)
    // Reference shows the decrease tail whenever there was prior noise; we only
    // show it on an actual drop, matching the HP/MP decrease semantics and
    // avoiding a spurious tail when noise rises.
    this.setSegWidth('noise-decrease', level < oldValue ? changeBar : 0)

    // The "N" caption stays put; "Silenced" shows in a separate span to the
    // right of the (now-black) bar, mirroring the reference's #stats_noise_status
    // rather than hiding the caption. (game.html keeps <span class="stats_caption">
    // static; player.js only sets #stats_noise_status.)
    const status = this.el.querySelector<HTMLElement>('#hud-noise-status')
    if (status) status.textContent = silenced ? 'Silenced' : ''
  }

  private buildWeapon(offhand: boolean): string {
    const s = this.state
    const idx = (offhand ? s.offhand_index : s.weapon_index)
      ?? (s.unarmed_attack !== undefined ? -1 : undefined)
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

  // Mirrors stat_class() in player.js: lost (status) → boosted (status) →
  // drained (current < max) → normal. Drained is the new case here.
  private statClass(stat: 'str' | 'int' | 'dex', val: number, max: number): string {
    const statuses = this.state.status ?? []
    const lostRe = new RegExp(`lost ${stat}`, 'i')
    if (statuses.some(st => st.text && lostRe.test(st.text))) return 'stat-zero'
    if (statuses.some(st => st.text && /vitalised/i.test(st.text))) return 'stat-boosted'
    if (val < max) return 'stat-degenerated'
    return ''
  }

  // Mirrors update_stat() in player.js: append " (max)" when the stat is drained
  // below its natural maximum, and colour the value accordingly.
  private renderStatValue(id: string, val: number | undefined, max: number | undefined, stat: 'str' | 'int' | 'dex'): void {
    const el = this.el.querySelector<HTMLElement>(`#${id}`)
    if (!el) return
    const v = val ?? 0
    const m = max ?? v
    // Drained: tuck the "(max)" tight against the value via .stat-max's margin
    // (a small fixed gap), rather than a full space, so the readout stays compact.
    if (v < m) el.innerHTML = `${v}<span class="stat-max">(${m})</span>`
    else el.textContent = String(v)
    el.classList.remove('stat-boosted', 'stat-zero', 'stat-degenerated')
    const cls = this.statClass(stat, v, m)
    if (cls) el.classList.add(cls)
  }

  // Contamination and Doom, mirroring update_contam/update_doom in player.js.
  // Both are shown only when nonzero (reference hides them at 0 unless
  // always_show_doom_contam is set) and coloured by severity. They occupy the
  // right end of the stats row (hidden when empty via .hg-warn:empty), where
  // they get the prominent slot since they're active danger meters; Noise moves
  // down to share the XL row with Time.
  private renderWarnings(): void {
    const parts: string[] = []
    const contam = this.state.contam ?? 0
    if (contam > 0) {
      const c = contam >= 200 ? 'fg4' : contam >= 100 ? 'fg14' : 'fg8'
      parts.push(`<span class="hg-grp"><span class="hg-caption">Contam</span><span class="${c}">${contam}%</span></span>`)
    }
    const doom = this.state.doom ?? 0
    if (doom > 0) {
      const c = doom >= 75 ? 'fg5' : doom >= 50 ? 'fg12' : doom >= 25 ? 'fg14' : 'fg7'
      parts.push(`<span class="hg-grp"><span class="hg-caption">Doom</span><span class="${c}">${doom}%</span></span>`)
    }
    // Joined with a space so the Contam↔Doom gap matches the inter-stat gap
    // (e.g. AC↔EV) — .hg-warn applies the same word-spacing to that space.
    const el = this.el.querySelector<HTMLElement>('#hud-warn')
    if (el) el.innerHTML = parts.join(' ')
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
        <span class="hg-warn" id="hud-warn"></span>
      </div>
      <div class="hg-xl-row">
        <span class="hg-xl-place hg-grp" id="hud-xl-place"></span>
        <span class="hg-noise-time">
          <span class="hg-noise"><span class="hg-caption">N</span><span class="hg-noise-cell" id="hud-noise-cell"><span class="hud-bar-seg noise-full"></span><span class="hud-bar-seg noise-decrease"></span></span><span class="hg-noise-status" id="hud-noise-status"></span></span>
          <span class="hg-time" id="hud-time"></span>
        </span>
      </div>
      <div class="hg-wq" id="hud-wq"></div>
      <div class="hg-wq" id="hud-wq-offhand"></div>
      <div class="hg-quiver" id="hud-quiver"></div>
    `
  }
}
