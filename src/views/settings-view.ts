// Settings overlay: a body-mounted full-screen modal reusing the doc-viewer
// shell classes, opened from the login footer and from the ⚙ key on the
// in-game virtual keyboard. The home page is a stack of sections (touch
// controls, map display, chat, help); a section may take over the body for a
// sub-page (the control-set editor) and return via renderHome. Changes apply
// live via window events, fired by the stores themselves (control-sets.ts
// mutators, setPref in prefs.ts): CONTROLS_CHANGED_EVENT (touch panel
// re-renders), RENDER_MODE_CHANGED_EVENT (game view swaps renderers),
// IGNORED_SPECTATORS_CHANGED_EVENT (chat spectator count, once merged).

import { mountCardOverlay } from './overlay'
import {
  cloneSet, deleteControlSet, encodeControlSet, getActiveControlSet,
  importControlSet, listControlSets, newSetId, saveControlSet,
  setActiveControlSet, slotLabel, slotTitle,
  GRID_ROWS, MAX_COLS, MAX_MACRO_LEN, PICKER_KEYS,
} from '../game/input/control-sets'
import type { ControlSet, ControlTabDef, SlotDef } from '../game/input/control-sets'
import { getPref, setPref } from '../prefs'
import { openAboutDoc, openChangelogDoc, openGesturesDoc } from './docs'

export function openSettings(): void {
  const { body } = mountCardOverlay('Settings', {
    backdrop: 'settings-backdrop',
    card: 'settings-card',
    body: 'settings-body',
  })
  renderHome(body)
}

// --- small DOM helpers -------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

function button(label: string, className: string, onTap: () => void): HTMLButtonElement {
  const b = el('button', className, label)
  b.type = 'button'
  b.addEventListener('click', onTap)
  return b
}

// Crawl keys/macros and player names aren't prose — keep mobile keyboards
// from "helping".
function noAutofix<T extends HTMLInputElement | HTMLTextAreaElement>(field: T): T {
  field.spellcheck = false
  field.setAttribute('autocapitalize', 'off')
  field.setAttribute('autocorrect', 'off')
  return field
}

// "My controls", "My controls 2", … first name not already taken.
function freshName(): string {
  const taken = new Set(listControlSets().map(s => s.name))
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'My controls' : `My controls ${n}`
    if (!taken.has(name)) return name
  }
}

// --- home page ---------------------------------------------------------------

function renderHome(body: HTMLElement): void {
  body.innerHTML = ''
  renderControlsSection(body)
  renderDisplaySection(body)
  renderChatSection(body)
  renderHelpSection(body)
}

// --- touch-controls section (control-set list) --------------------------------

function renderControlsSection(body: HTMLElement): void {
  body.appendChild(el('h2', 'settings-h', 'Touch controls'))
  body.appendChild(el('p', 'settings-hint',
    'Control sets swap the buttons on the three control tabs.'))

  const sets = listControlSets()
  const activeId = getActiveControlSet().id
  const list = el('div', 'set-list')
  body.appendChild(list)

  for (const set of sets) {
    const row = el('div', 'set-row' + (set.id === activeId ? ' active' : ''))

    const main = button('', 'set-row-main', () => {
      setActiveControlSet(set.id)
      renderHome(body)
    })
    main.appendChild(el('span', 'set-radio', set.id === activeId ? '●' : '○'))
    main.appendChild(el('span', 'set-name', set.name))
    if (set.builtin) main.appendChild(el('span', 'set-badge', 'built-in'))
    row.appendChild(main)

    const actions = el('div', 'set-row-actions')
    actions.hidden = true
    const more = button('⋯', 'set-row-more', () => { actions.hidden = !actions.hidden })
    more.setAttribute('aria-label', `Actions for ${set.name}`)
    row.appendChild(more)
    list.appendChild(row)

    if (!set.builtin) {
      actions.appendChild(button('Edit', 'set-action', () => renderEditor(body, set, false)))
    }
    actions.appendChild(button('Duplicate', 'set-action', () => {
      saveControlSet(cloneSet(set, newSetId(), freshName()))
      renderHome(body)
    }))
    const exp = button('Export', 'set-action', () => exportSet(set, exp, actions))
    actions.appendChild(exp)
    if (!set.builtin) {
      const del = button('Delete', 'set-action set-action-danger', () => {
        if (del.dataset.armed !== '1') {
          del.dataset.armed = '1'
          del.textContent = 'Really delete?'
          return
        }
        deleteControlSet(set.id)
        renderHome(body)
      })
      actions.appendChild(del)
    }
    list.appendChild(actions)
  }

  const actionsBar = el('div', 'settings-actions')
  body.appendChild(actionsBar)

  // Import area (collapsed behind the button)
  const importWrap = el('div', 'settings-import')
  importWrap.hidden = true
  const importField = noAutofix(el('textarea', 'settings-import-field settings-input'))
  importField.placeholder = 'Paste a pocketzot-controls:… string'
  importField.rows = 3
  const importErr = el('div', 'settings-error')
  importErr.hidden = true
  const importGo = button('Import', 'settings-btn', () => {
    importErr.hidden = true
    try {
      const set = importControlSet(importField.value)
      setActiveControlSet(set.id)  // fresh-install flow: imported = wanted
      renderHome(body)
    } catch (err) {
      importErr.textContent = `Couldn't import: ${err instanceof Error ? err.message : String(err)}`
      importErr.hidden = false
    }
  })
  importWrap.appendChild(importField)
  importWrap.appendChild(importErr)
  importWrap.appendChild(importGo)

  actionsBar.appendChild(button('＋ New set', 'settings-btn', () => {
    // Start from whatever is active — the closest thing to "what I have now".
    renderEditor(body, cloneSet(getActiveControlSet(), newSetId(), freshName()), true)
  }))
  actionsBar.appendChild(button('Import…', 'settings-btn', () => {
    importWrap.hidden = !importWrap.hidden
    if (!importWrap.hidden) importField.focus()
  }))
  body.appendChild(importWrap)
}

// --- map display section -------------------------------------------------------

const RENDER_MODES = [
  { mode: 'ascii', label: 'ASCII' },
  { mode: 'tiles', label: 'Tiles' },
] as const

function renderDisplaySection(body: HTMLElement): void {
  body.appendChild(el('h2', 'settings-h', 'Map display'))
  body.appendChild(el('p', 'settings-hint',
    'A two-finger long-press on the map also toggles this mid-game.'))
  const seg = el('div', 'settings-seg seg')
  seg.setAttribute('role', 'radiogroup')
  seg.setAttribute('aria-label', 'Map display')
  const active = getPref('mapRenderMode')
  for (const { mode, label } of RENDER_MODES) {
    const b = button(label, 'settings-btn' + (mode === active ? ' active' : ''), () => {
      if (getPref('mapRenderMode') === mode) return
      setPref('mapRenderMode', mode)  // fires RENDER_MODE_CHANGED_EVENT
      for (const sib of seg.children) {
        sib.classList.toggle('active', sib === b)
        sib.setAttribute('aria-checked', String(sib === b))
      }
    })
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-checked', String(mode === active))
    seg.appendChild(b)
  }
  body.appendChild(seg)
}

// --- chat section ----------------------------------------------------------------

function renderChatSection(body: HTMLElement): void {
  body.appendChild(el('h2', 'settings-h', 'Chat'))
  body.appendChild(el('p', 'settings-hint',
    "Spectator names that won't be counted. Prevents bots " +
    'from keeping the spectator chip lit.'))
  const chips = el('div', 'settings-chips')
  const save = (names: string[]): void => {
    setPref('ignoredSpectators', names)  // fires IGNORED_SPECTATORS_CHANGED_EVENT
    renderChips()
  }
  function renderChips(): void {
    chips.innerHTML = ''
    for (const name of getPref('ignoredSpectators')) {
      const chip = el('span', 'settings-chip')
      chip.appendChild(el('span', 'settings-chip-name', name))
      const x = button('✕', 'settings-chip-x', () =>
        save(getPref('ignoredSpectators').filter(n => n !== name)))
      x.setAttribute('aria-label', `Stop ignoring ${name}`)
      chip.appendChild(x)
      chips.appendChild(chip)
    }
    chips.hidden = chips.childElementCount === 0
  }
  const addRow = el('div', 'settings-add-row')
  const input = noAutofix(el('input', 'settings-add-input settings-input'))
  input.placeholder = 'bot name'
  input.maxLength = 32
  const add = (): void => {
    const name = input.value.trim()
    if (!name) return
    const names = getPref('ignoredSpectators')
    if (!names.some(n => n.toLowerCase() === name.toLowerCase())) save([...names, name])
    input.value = ''
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add() } })
  addRow.appendChild(input)
  addRow.appendChild(button('Add', 'settings-btn', add))
  renderChips()
  body.appendChild(chips)
  body.appendChild(addRow)
}

// --- help section --------------------------------------------------------------

function renderHelpSection(body: HTMLElement): void {
  body.appendChild(el('h2', 'settings-h', 'Help'))
  const row = el('div', 'settings-actions')
  // The docs mount their own card above this one (doc z-index > settings).
  row.appendChild(button('About', 'settings-btn', openAboutDoc))
  row.appendChild(button("What's new", 'settings-btn', openChangelogDoc))
  row.appendChild(button('Gestures', 'settings-btn', openGesturesDoc))
  body.appendChild(row)
}

// Copy the export string; iOS clipboard needs a user gesture, which this is.
// Success feedback morphs the Export button itself ("Copied ✓") — right where
// the finger just was, no layout shift. On failure (or where the API is
// missing) fall back to a visible, selected textarea on its own row.
function exportSet(set: ControlSet, btn: HTMLButtonElement, host: HTMLElement): void {
  const str = encodeControlSet(set)
  const flash = (): void => {
    btn.textContent = 'Copied ✓'
    btn.classList.add('flash')
    btn.disabled = true
    setTimeout(() => {
      btn.textContent = 'Export'
      btn.classList.remove('flash')
      btn.disabled = false
    }, 1500)
  }
  const fallback = (): void => {
    host.querySelector('.settings-export-out')?.remove()
    const out = el('div', 'settings-export-out')
    const field = el('textarea', 'settings-import-field settings-input')
    field.value = str
    field.readOnly = true
    field.rows = 3
    field.addEventListener('focus', () => field.select())
    out.appendChild(field)
    host.appendChild(out)
    field.focus()
  }
  const clip = navigator.clipboard
  if (clip?.writeText) clip.writeText(str).then(flash, fallback)
  else fallback()
}

// --- editor ------------------------------------------------------------------

interface TabModel {
  name: string
  cols: 3 | 4
  grid: (SlotDef | null)[]  // always 3×4 row-major while editing, so toggling
                            // a tab 4→3→4 never loses its 4th-column keys
}

function padGrid(tab: ControlTabDef): (SlotDef | null)[] {
  const grid: (SlotDef | null)[] = []
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < MAX_COLS; c++) {
      grid.push(c < tab.cols ? (tab.slots[r * tab.cols + c] ?? null) : null)
    }
  }
  return grid
}

function cropGrid(grid: (SlotDef | null)[], cols: 3 | 4): (SlotDef | null)[] {
  const slots: (SlotDef | null)[] = []
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < cols; c++) slots.push(grid[r * MAX_COLS + c])
  }
  return slots
}

function renderEditor(body: HTMLElement, set: ControlSet, isNew: boolean): void {
  body.innerHTML = ''
  // A new set always opens at 3×4 — the full canvas — regardless of the
  // cloned base's grid sizes; its keys land in the first three columns.
  const tabs: TabModel[] = set.tabs.map(tab => ({
    name: tab.name,
    cols: isNew ? 4 : tab.cols,
    grid: padGrid(tab),
  }))
  // (tabIdx, cell) of the slot the picker is editing, or null when closed
  let picking: { tab: number; cell: number } | null = null

  body.appendChild(el('h2', 'settings-h', isNew ? 'New control set' : 'Edit control set'))

  const nameRow = el('label', 'ed-name-row', 'Name ')
  const nameInput = el('input', 'ed-name-input settings-input')
  nameInput.value = set.name
  nameInput.maxLength = 48
  nameInput.spellcheck = false
  nameRow.appendChild(nameInput)
  body.appendChild(nameRow)

  const tabsHost = el('div', 'ed-tabs')
  body.appendChild(tabsHost)

  // Key picker — one shared panel below the grids; assigns into `picking`.
  const picker = el('div', 'ed-picker')
  picker.hidden = true

  function renderTabs(): void {
    tabsHost.innerHTML = ''
    tabs.forEach((tab, ti) => {
      const box = el('div', 'ed-tab')

      const head = el('div', 'ed-tab-head')
      const charLabel = el('label', 'ed-tab-charlabel', 'Tab label ')
      const charInput = noAutofix(el('input', 'ed-tab-char settings-input'))
      charInput.value = tab.name
      charInput.maxLength = 1
      charInput.addEventListener('input', () => {
        if (charInput.value.trim()) tab.name = charInput.value
      })
      // Blank or whitespace stays whatever it was — a tab must keep a
      // visible label (import enforces the same rule).
      charInput.addEventListener('blur', () => { charInput.value = tab.name })
      charLabel.appendChild(charInput)
      head.appendChild(charLabel)

      const sizeToggle = el('div', 'ed-size-toggle seg')
      for (const cols of [3, 4] as const) {
        const sb = button(`3×${cols}`, 'ed-size-btn' + (tab.cols === cols ? ' active' : ''), () => {
          tab.cols = cols
          if (picking?.tab === ti) closePicker()
          renderTabs()
        })
        sizeToggle.appendChild(sb)
      }
      head.appendChild(sizeToggle)
      box.appendChild(head)

      const grid = el('div', 'ed-grid')
      grid.style.gridTemplateColumns = `repeat(${tab.cols}, 1fr)`
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < tab.cols; c++) {
          const cell = r * MAX_COLS + c
          const slot = tab.grid[cell]
          const label = slot ? slotLabel(slot) : '·'
          const sb = button(label, 'ed-slot' + (slot ? '' : ' empty'), () => openPicker(ti, cell))
          if (slot) {
            const title = slotTitle(slot)
            if (title) sb.title = title
          }
          if (picking && picking.tab === ti && picking.cell === cell) sb.classList.add('picking')
          grid.appendChild(sb)
        }
      }
      box.appendChild(grid)
      tabsHost.appendChild(box)
    })
  }

  function openPicker(tab: number, cell: number): void {
    picking = { tab, cell }
    picker.hidden = false
    buildPicker()
    renderTabs()
    picker.scrollIntoView({ block: 'nearest' })
  }

  function closePicker(): void {
    picking = null
    picker.hidden = true
    renderTabs()
  }

  function assign(slot: SlotDef | null): void {
    if (!picking) return
    tabs[picking.tab].grid[picking.cell] = slot
    closePicker()
  }

  function buildPicker(): void {
    picker.innerHTML = ''
    if (!picking) return
    const tab = tabs[picking.tab]
    const row = Math.floor(picking.cell / MAX_COLS) + 1
    const col = (picking.cell % MAX_COLS) + 1
    picker.appendChild(el('div', 'ed-picker-title',
      `Tab ${tab.name} · row ${row}, key ${col}`))

    const textRow = el('div', 'ed-picker-textrow')
    const textInput = noAutofix(el('input', 'ed-picker-text settings-input'))
    textInput.maxLength = MAX_MACRO_LEN
    textInput.placeholder = "key(s), e.g. 'o' or 'za.'"
    const current = tab.grid[picking.cell]
    if (current?.text) textInput.value = current.text
    const setText = (): void => { if (textInput.value) assign({ text: textInput.value }) }
    textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setText() } })
    textRow.appendChild(textInput)
    textRow.appendChild(button('Set', 'settings-btn ed-picker-set', setText))
    picker.appendChild(textRow)

    const keys = el('div', 'ed-picker-keys')
    for (const sk of PICKER_KEYS) {
      const kb = button(sk.label, 'ed-key', () => assign({ key: sk.keycode }))
      kb.title = sk.title
      keys.appendChild(kb)
    }
    picker.appendChild(keys)

    const foot = el('div', 'ed-picker-foot')
    foot.appendChild(button('Clear key', 'set-action', () => assign(null)))
    foot.appendChild(button('Cancel', 'set-action', closePicker))
    picker.appendChild(foot)
  }

  body.appendChild(picker)

  const foot = el('div', 'settings-actions')
  foot.appendChild(button('Cancel', 'settings-btn', () => renderHome(body)))
  foot.appendChild(button('Save', 'settings-btn settings-btn-primary', () => {
    const name = nameInput.value.trim() || set.name
    const saved: ControlSet = {
      id: set.id,
      name,
      tabs: tabs.map(tab => ({
        name: tab.name,
        cols: tab.cols,
        slots: cropGrid(tab.grid, tab.cols),
      })) as ControlSet['tabs'],
    }
    saveControlSet(saved)
    if (isNew) setActiveControlSet(saved.id)  // you just built it — use it
    renderHome(body)
  }))
  body.appendChild(foot)

  renderTabs()
}
