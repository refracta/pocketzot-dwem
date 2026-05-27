type UsernameStyle = {
  id?: string
  data?: Record<string, unknown> | null
}

type CncProfile = {
  username?: string
  currentBanner?: {
    usernameStyle?: UsernameStyle | null
  } | null
  lastUpdatedAt?: string | null
}

type ProfileCacheEntry = {
  profile: CncProfile | null
  username: string
  checkedAt: string
  missing: boolean
}

type ProfileRequest = {
  username: string
  lastUpdatedAt?: string | null
}

type ProfileBatchResponse = {
  generatedAt?: string
  profiles?: CncProfile[]
  missing?: string[]
  unchanged?: string[]
}

type StyleMap = Record<string, string | number>

const CNC_HOSTS = new Set(['crawl.nemelex.cards', 'test.nemelex.cards'])

export class CncUserinfo {
  static readonly NEMELEX_COLORS = ['#008cc0', '#009800', '#8000ff', '#cad700', '#ff4000']
  static readonly PROFILE_API_BASE = 'https://profiles.nemelex.cards'
  static readonly PROFILE_ACTIVE_FETCH_MS = 250
  static readonly PROFILE_IDLE_FETCH_MS = 30_000

  private static readonly PREFIX_BADGES = [
    '\u{1F916}',
    '\u{1F451}',
    '\u{1F3C6}',
    '\u{1F947}',
    '\u{1F48E}',
    '\u{1F31F}',
    '\u2B50',
    '\u26A1',
    '\u{1F680}',
    '\u{1F3CE}\uFE0F',
    '\u{1F3CE}',
    '\u{1F4A8}',
    '\u{1F6E0}\uFE0F',
    '\u{1F6E0}',
    '\u{1F3C1}',
  ]

  private profileCache = new Map<string, ProfileCacheEntry>()
  private trackedProfileUsernames = new Map<string, string>()
  private profileFetchPromise: Promise<void> | null = null
  private profileFetchTimer: number | null = null
  private profileFetchNextAt = 0

  onLoad(): void {
    this.profileCache = new Map()
    this.trackedProfileUsernames = new Map()
    this.profileFetchPromise = null
    this.clearProfileFetchTimer()
  }

  isEnabledForServer(wsUrl: string): boolean {
    try {
      return CNC_HOSTS.has(new URL(wsUrl).hostname)
    } catch {
      return false
    }
  }

  applyStyledUsername(username: string, options: { track?: boolean } = {}): string {
    const cleanUsername = this.normalizeUsername(username)
    if (!cleanUsername) return ''

    const key = this.getProfileKey(cleanUsername)
    if (options.track !== false) {
      this.trackProfileUsername(cleanUsername)
    }

    const styledUsername = this.renderUsernameStyle(
      cleanUsername,
      this.getProfile(cleanUsername)?.currentBanner?.usernameStyle ?? null,
    )
    return `<span class="cnc-profile-username" data-cnc-profile-username="${this.escapeHtml(cleanUsername)}" data-cnc-profile-key="${this.escapeHtml(key)}">${styledUsername}</span>`
  }

  renderUsernameStyle(username: string, usernameStyle?: UsernameStyle | null): string {
    if (!usernameStyle?.id) {
      return this.escapeHtml(username)
    }

    const data = this.getStyleData(usernameStyle)
    if (usernameStyle.id === 'nemelex') {
      return this.createNemelexSpan(
        username,
        this.getNemelexColors(data['colors']),
        Number(data['split'] ?? 1),
        Number(data['time'] ?? 60),
      )
    }

    if (usernameStyle.id === 'donor') {
      return `<span style="${this.styleObjectToString(this.getDonorStyle(data['donation']))}">${this.escapeHtml(username)}</span>`
    }

    if (usernameStyle.id === 'translator') {
      return `<span style="${this.styleObjectToString(this.getTranslatorStyle(data['intensity']))}">${this.escapeHtml(username)}</span>`
    }

    if (usernameStyle.id === 'bot') {
      return `${this.createUsernamePrefixSpan(String(data['prefix'] ?? '\u{1F916}'))}${this.escapeHtml(username)}`
    }

    if (usernameStyle.id === 'ranking') {
      return `${this.createUsernamePrefixSpan(String(data['badge'] ?? this.getRankingBadge(data['rank'])))}${this.escapeHtml(username)}`
    }

    if (usernameStyle.id === 'fastest-win') {
      return `${this.createUsernamePrefixSpan(String(data['badge'] ?? this.getFastestWinBadge(data['rank'])))}${this.escapeHtml(username)}`
    }

    if (usernameStyle.id === 'dcss-contributor') {
      return `${this.createUsernamePrefixSpan(String(data['badge'] ?? '\u{1F6E0}\uFE0F'))}${this.escapeHtml(username)}`
    }

    if (usernameStyle.id === 'osp-contributor') {
      return this.createOspContributorSpan(username)
    }

    if (usernameStyle.id === 'win-streak') {
      return `${this.createWinStreakBadgeSpan(data['streak'])}${this.escapeHtml(username)}`
    }

    if (usernameStyle.id === 'current-win-streak') {
      return `${this.createCurrentWinStreakBadgeSpan(data['streak'])}${this.escapeHtml(username)}`
    }

    if (usernameStyle.id === 'latest-tournament') {
      return `${this.createUsernamePrefixSpan(String(data['badge'] ?? '\u{1F3C1}'))}${this.escapeHtml(username)}`
    }

    return this.escapeHtml(username)
  }

  getProfile(username: string): CncProfile | null {
    return this.profileCache.get(this.getProfileKey(username))?.profile ?? null
  }

  normalizeUsername(username: string): string {
    let clean = String(username || '').replace(/ \(admin\)/g, '').trim()

    let stripped = true
    while (stripped) {
      stripped = false
      for (const badge of CncUserinfo.PREFIX_BADGES) {
        if (clean.startsWith(badge)) {
          clean = clean.slice(badge.length).trimStart()
          stripped = true
        }
      }
    }

    return clean
  }

  getProfileKey(username: string): string {
    return this.normalizeUsername(username).toLowerCase()
  }

  trackProfileUsername(username: string): void {
    const cleanUsername = this.normalizeUsername(username)
    const key = this.getProfileKey(cleanUsername)
    if (!key) return

    const isNewTrackedUsername = !this.trackedProfileUsernames.has(key)
    this.trackedProfileUsernames.set(key, cleanUsername)
    if (isNewTrackedUsername || !this.profileCache.has(key)) {
      this.scheduleProfileFetch(CncUserinfo.PROFILE_ACTIVE_FETCH_MS)
    }
  }

  async fetchTrackedProfiles(): Promise<void> {
    if (this.profileFetchPromise || !this.trackedProfileUsernames.size) {
      return
    }

    const profiles = [...this.trackedProfileUsernames.entries()].map(([key, username]) => ({
      username,
      lastUpdatedAt: this.profileCache.get(key)?.profile?.lastUpdatedAt,
    }))

    await this.fetchProfileBatch(profiles)
  }

  async preloadProfiles(usernames: string[]): Promise<void> {
    const profiles: ProfileRequest[] = []
    const seen = new Set<string>()

    for (const username of usernames) {
      const cleanUsername = this.normalizeUsername(username)
      const key = this.getProfileKey(cleanUsername)
      if (!key || seen.has(key)) continue

      seen.add(key)
      this.trackProfileUsername(cleanUsername)
      profiles.push({
        username: cleanUsername,
        lastUpdatedAt: this.profileCache.get(key)?.profile?.lastUpdatedAt,
      })
    }

    if (!profiles.length) return
    if (this.profileFetchPromise) await this.profileFetchPromise
    await this.fetchProfileBatch(profiles)
  }

  escapeHtml(value: unknown): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  private async fetchProfileBatch(profiles: ProfileRequest[]): Promise<void> {
    if (!profiles.length) return

    this.clearProfileFetchTimer()
    const fetchPromise = this.requestProfileBatch(profiles)
    this.profileFetchPromise = fetchPromise

    try {
      await fetchPromise
    } finally {
      if (this.profileFetchPromise === fetchPromise) {
        this.profileFetchPromise = null
      }
      this.scheduleNextProfileFetch()
    }
  }

  private async requestProfileBatch(profiles: ProfileRequest[]): Promise<void> {
    try {
      const response = await fetch(`${this.getProfilesApiBase()}/api/profiles/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles }),
      })

      if (!response.ok) return

      const data = await response.json() as ProfileBatchResponse
      const checkedAt = data.generatedAt || new Date().toISOString()
      const requestedUsernames = new Map<string, string>()
      for (const item of profiles) {
        const key = this.getProfileKey(item.username)
        if (key) requestedUsernames.set(key, item.username)
      }

      for (const profile of data.profiles || []) {
        const profileUsername = profile.username || requestedUsernames.get(this.getProfileKey(profile.username || ''))
        if (!profileUsername) continue

        const key = this.getProfileKey(profileUsername)
        this.profileCache.set(key, {
          profile,
          username: profileUsername,
          checkedAt,
          missing: false,
        })
        this.refreshStyledUsername(profileUsername)
      }

      for (const username of data.missing || []) {
        const key = this.getProfileKey(username)
        if (!key) continue

        const previous = this.profileCache.get(key)
        const cacheUsername = requestedUsernames.get(key) || previous?.username || username
        this.profileCache.set(key, {
          profile: null,
          username: cacheUsername,
          checkedAt,
          missing: true,
        })

        if (previous?.profile) {
          this.refreshStyledUsername(cacheUsername)
        }
      }

      for (const username of data.unchanged || []) {
        const key = this.getProfileKey(username)
        const previous = this.profileCache.get(key)
        if (!key || !previous) continue

        this.profileCache.set(key, {
          ...previous,
          checkedAt,
          missing: !previous.profile,
        })
      }
    } catch (err) {
      if (this.isDebugEnabled()) {
        console.warn('Failed to fetch CNC profiles', err)
      }
    }
  }

  private scheduleNextProfileFetch(): void {
    if (!this.trackedProfileUsernames.size) return

    const hasUncheckedProfile = [...this.trackedProfileUsernames.keys()]
      .some(key => !this.profileCache.has(key))
    this.scheduleProfileFetch(
      hasUncheckedProfile
        ? CncUserinfo.PROFILE_ACTIVE_FETCH_MS
        : CncUserinfo.PROFILE_IDLE_FETCH_MS,
    )
  }

  private scheduleProfileFetch(delay: number): void {
    if (!this.trackedProfileUsernames.size) return

    const safeDelay = Math.max(0, Number(delay) || 0)
    const nextAt = Date.now() + safeDelay
    if (this.profileFetchTimer && this.profileFetchNextAt && this.profileFetchNextAt <= nextAt) {
      return
    }

    this.clearProfileFetchTimer()
    this.profileFetchNextAt = nextAt
    this.profileFetchTimer = window.setTimeout(() => {
      this.profileFetchTimer = null
      this.profileFetchNextAt = 0
      void this.fetchTrackedProfiles()
    }, safeDelay)
  }

  private clearProfileFetchTimer(): void {
    if (!this.profileFetchTimer) return
    window.clearTimeout(this.profileFetchTimer)
    this.profileFetchTimer = null
    this.profileFetchNextAt = 0
  }

  private refreshStyledUsername(username: string): void {
    if (typeof document === 'undefined') return

    const key = this.getProfileKey(username)
    for (const element of document.querySelectorAll<HTMLElement>('[data-cnc-profile-key]')) {
      if (element.dataset['cncProfileKey'] !== key) continue

      const elementUsername = element.dataset['cncProfileUsername'] || username
      element.innerHTML = this.renderUsernameStyle(
        elementUsername,
        this.getProfile(elementUsername)?.currentBanner?.usernameStyle ?? null,
      )
    }
  }

  private getProfilesApiBase(): string {
    try {
      const override = window.localStorage.getItem('CNC_PROFILES_API')
      return override || CncUserinfo.PROFILE_API_BASE
    } catch {
      return CncUserinfo.PROFILE_API_BASE
    }
  }

  private getStyleData(usernameStyle: UsernameStyle): Record<string, unknown> {
    return usernameStyle.data && typeof usernameStyle.data === 'object'
      ? usernameStyle.data
      : {}
  }

  private createUsernamePrefixSpan(prefix: string): string {
    return `<span style="display: inline-block; text-decoration: none;">${this.escapeHtml(prefix)}</span>`
  }

  private createNemelexSpan(text: string, colorArray: string[], split: number, time: number): string {
    const safeSplit = Math.max(1, Math.floor(Number.isFinite(split) ? split : 1))
    if (!text || !colorArray.length) return this.escapeHtml(text)

    const currentTime = Date.now()
    const intervalMs = Math.abs(Number.isFinite(time) ? time : 60) * 1000
    const offset = intervalMs > 0 ? Math.floor(currentTime / intervalMs) % colorArray.length : 0
    const rollOffset = time < 0 ? offset : (colorArray.length - offset) % colorArray.length
    const rotatedColors = colorArray.map((_, index) => colorArray[(index + rollOffset) % colorArray.length])
    const chars = Array.from(text)
    const parts: string[] = []

    for (let i = 0; i < chars.length; i += safeSplit) {
      parts.push(chars.slice(i, i + safeSplit).join(''))
    }

    return parts.map((part, index) => {
      const color = rotatedColors[index % rotatedColors.length]
      return `<span style="color: ${color}">${this.escapeHtml(part)}</span>`
    }).join('')
  }

  private createOspContributorSpan(username: string): string {
    const chars = Array.from(String(username || ''))
    if (chars.length === 0) return ''

    const lastIndex = chars.length - 1
    return chars.map((char, index) => {
      const isLast = index === lastIndex
      const color = isLast ? '#ff3b30' : '#a8ff3e'
      const shadow = isLast
        ? '0 0 4px rgba(255, 59, 48, 0.55)'
        : '0 0 3px rgba(168, 255, 62, 0.45)'
      return `<span style="color: ${color}; font-weight: 800; text-shadow: ${shadow};">${this.escapeHtml(char)}</span>`
    }).join('')
  }

  private createWinStreakBadgeSpan(streak: unknown): string {
    const safeStreak = Math.max(1, Math.floor(Number(streak) || 1))
    return `<span aria-label="${safeStreak} win streak" title="${safeStreak} win streak" style="${this.styleObjectToString(this.getWinStreakBadgeStyle(safeStreak))}">${safeStreak.toLocaleString('en-US')}</span>`
  }

  private createCurrentWinStreakBadgeSpan(streak: unknown): string {
    const safeStreak = Math.max(1, Math.floor(Number(streak) || 1))
    return `<span aria-label="${safeStreak} current win streak" title="${safeStreak} current win streak" style="${this.styleObjectToString(this.getCurrentWinStreakBadgeStyle(safeStreak))}">${safeStreak.toLocaleString('en-US')}</span>`
  }

  private getNemelexColors(colors: unknown): string[] {
    const safeColors = Array.isArray(colors)
      ? colors
        .map(color => String(color || '').trim())
        .filter(color => /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color))
      : []
    return safeColors.length > 0 ? safeColors : CncUserinfo.NEMELEX_COLORS
  }

  private getDonorStyle(amount: unknown): StyleMap {
    const maxAmount = 500_000
    const clamped = Math.max(0, Math.min(maxAmount, Number(amount) || 0))
    const progress = clamped / maxAmount
    const color = this.mixGoldColor(Math.pow(progress, 0.72))
    const glowSize = 5 + progress * 18
    const style: StyleMap = {
      color,
      'font-weight': '800',
      'text-shadow': `0 0 ${glowSize}px rgba(255, 216, 94, ${0.18 + progress * 0.5}), 0 1px 0 rgba(70, 42, 0, ${progress * 0.25})`,
      filter: `drop-shadow(0 0 ${glowSize}px rgba(255, 211, 72, ${0.08 + progress * 0.25}))`,
    }

    if (progress >= 0.18) {
      style['background-image'] = `linear-gradient(115deg, ${color} 0%, #fff8d8 ${28 + progress * 18}%, ${color} ${60 + progress * 12}%, #8f6400 100%)`
      style['-webkit-background-clip'] = 'text'
      style['background-clip'] = 'text'
      style['-webkit-text-fill-color'] = 'transparent'
    }

    return style
  }

  private getTranslatorStyle(intensity: unknown): StyleMap {
    const t = Math.max(0, Math.min(1, Number(intensity) || 0))
    const chroma = Math.pow(t, 1.6)
    const red = this.mixColor('#607088', '#d61f3c', chroma)
    const paper = this.mixColor('#dce5ee', '#f8fbff', t)
    const blue = this.mixColor('#4d6681', '#1457b8', Math.pow(t, 1.1))
    const navy = this.mixColor('#3b526d', '#0b2f73', t)
    const redStop = 2 + t * 22
    const whiteStop = 56 - t * 28
    const blueStop = 76 - t * 18
    return {
      color: '#4d6681',
      'font-weight': '800',
      'background-image': `linear-gradient(${108 + t * 24}deg, ${red} 0%, ${red} ${redStop}%, ${paper} ${whiteStop}%, ${blue} ${blueStop}%, ${navy} 100%)`,
      '-webkit-background-clip': 'text',
      'background-clip': 'text',
      '-webkit-text-fill-color': 'transparent',
      'text-shadow': `0 0 ${2 + t * 10}px rgba(214, 31, 60, ${t * 0.32}), 0 0 ${3 + t * 12}px rgba(20, 87, 184, ${0.08 + t * 0.34})`,
    }
  }

  private getWinStreakBadgeStyle(streak: number): StyleMap {
    const t = Math.max(0, Math.min(1, ((Number(streak) || 2) - 2) / 48))
    const heat = Math.pow(t, 0.72)
    const glow = 4 + heat * 14
    const rim = this.mixColor('#ffbf63', '#fff1a8', heat)
    const top = this.mixColor('#ff9830', '#fff27a', heat)
    const middle = this.mixColor('#e84a1a', '#ff3214', heat)
    const bottom = this.mixColor('#93200d', '#5c0300', heat)
    const text = this.mixColor('#fff0c2', '#ffffff', heat)
    const highlightStop = 16 + heat * 12
    const fadeStop = 38 - heat * 12
    const middleStop = 58 - heat * 18
    return {
      display: 'inline-flex',
      'align-items': 'center',
      'justify-content': 'center',
      'min-width': '1.7em',
      height: '1.25em',
      padding: '0 0.34em',
      'margin-right': '0.18em',
      'border-radius': '999px 999px 760px 760px',
      color: text,
      'font-size': '0.78em',
      'font-weight': '900',
      'line-height': '1',
      'letter-spacing': '0',
      'vertical-align': '0.08em',
      border: `1px solid ${rim}`,
      'background-image': `radial-gradient(circle at 50% 8%, ${top} 0%, #ffd35b ${highlightStop}%, transparent ${fadeStop}%), linear-gradient(180deg, ${top} 0%, ${middle} ${middleStop}%, ${bottom} 100%)`,
      'box-shadow': `0 -1px ${3 + heat * 6}px rgba(255, 235, 106, ${0.34 + heat * 0.56}), 0 0 ${glow}px rgba(255, 57, 18, ${0.28 + heat * 0.6}), inset 0 1px 0 rgba(255, 255, 255, ${0.24 + heat * 0.28})`,
      filter: `saturate(${1 + heat * 0.65}) brightness(${1 + heat * 0.12})`,
      'text-shadow': '0 1px 1px rgba(68, 12, 0, 0.85)',
    }
  }

  private getCurrentWinStreakBadgeStyle(streak: number): StyleMap {
    const t = Math.max(0, Math.min(1, ((Number(streak) || 2) - 2) / 48))
    const charge = Math.pow(t, 0.7)
    const glow = 4 + charge * 14
    const rim = this.mixColor('#7fd7ff', '#dff7ff', charge)
    const top = this.mixColor('#71d2ff', '#e4fbff', charge)
    const middle = this.mixColor('#268cff', '#0f6eff', charge)
    const bottom = this.mixColor('#134a9c', '#052464', charge)
    const text = this.mixColor('#e6f8ff', '#ffffff', charge)
    const highlightStop = 16 + charge * 12
    const fadeStop = 40 - charge * 12
    const middleStop = 58 - charge * 18
    return {
      display: 'inline-flex',
      'align-items': 'center',
      'justify-content': 'center',
      'min-width': '1.7em',
      height: '1.25em',
      padding: '0 0.34em',
      'margin-right': '0.18em',
      'border-radius': '999px',
      color: text,
      'font-size': '0.78em',
      'font-weight': '900',
      'line-height': '1',
      'letter-spacing': '0',
      'vertical-align': '0.08em',
      border: `1px solid ${rim}`,
      'background-image': `radial-gradient(circle at 50% 10%, ${top} 0%, #b8efff ${highlightStop}%, transparent ${fadeStop}%), linear-gradient(180deg, ${top} 0%, ${middle} ${middleStop}%, ${bottom} 100%)`,
      'box-shadow': `0 -1px ${3 + charge * 6}px rgba(184, 239, 255, ${0.36 + charge * 0.5}), 0 0 ${glow}px rgba(27, 126, 255, ${0.26 + charge * 0.58}), inset 0 1px 0 rgba(255, 255, 255, ${0.26 + charge * 0.28})`,
      filter: `saturate(${1 + charge * 0.6}) brightness(${1 + charge * 0.12})`,
      'text-shadow': '0 1px 1px rgba(3, 20, 58, 0.85)',
    }
  }

  private getRankingBadge(rank: unknown): string {
    const safeRank = Math.max(1, Math.floor(Number(rank) || 1))
    if (safeRank === 1) return '\u{1F451}'
    if (safeRank <= 3) return '\u{1F3C6}'
    if (safeRank <= 10) return '\u{1F947}'
    if (safeRank <= 25) return '\u{1F48E}'
    if (safeRank <= 50) return '\u{1F31F}'
    if (safeRank <= 100) return '\u2B50'
    return ''
  }

  private getFastestWinBadge(rank: unknown): string {
    const safeRank = Math.max(1, Math.floor(Number(rank) || 1))
    if (safeRank === 1) return '\u26A1'
    if (safeRank <= 3) return '\u{1F680}'
    if (safeRank <= 5) return '\u{1F3CE}\uFE0F'
    if (safeRank <= 10) return '\u{1F4A8}'
    return ''
  }

  private mixGoldColor(t: number): string {
    const stops = [
      { at: 0, color: '#ffffff' },
      { at: 0.08, color: '#fff9e8' },
      { at: 0.18, color: '#ffefbd' },
      { at: 0.38, color: '#ffd95f' },
      { at: 0.68, color: '#efb72e' },
      { at: 1, color: '#b8860b' },
    ]
    let left = stops[0]
    let right = stops[stops.length - 1]

    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].at && t <= stops[i + 1].at) {
        left = stops[i]
        right = stops[i + 1]
        break
      }
    }

    const localT = right.at === left.at ? 0 : (t - left.at) / (right.at - left.at)
    return this.mixColor(left.color, right.color, localT)
  }

  private mixColor(from: string, to: string, t: number): string {
    const a = this.hexToRgb(from)
    const b = this.hexToRgb(to)
    return this.rgbToHex({
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t,
    })
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const value = Number.parseInt(hex.replace('#', ''), 16)
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255,
    }
  }

  private rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
    const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  }

  private styleObjectToString(style: StyleMap): string {
    return Object.entries(style)
      .map(([key, value]) => `${key}: ${value}`)
      .join('; ')
  }

  private isDebugEnabled(): boolean {
    try {
      return Boolean(window.localStorage.getItem('DWEM_DEBUG'))
    } catch {
      return false
    }
  }
}

export const cncUserinfo = new CncUserinfo()
