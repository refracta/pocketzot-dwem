import JSZip from 'jszip'
import { commandManager } from './command-manager'
import { ioHook, type IncomingMessage } from './io-hook'
import { rcManager } from './rc-manager'
import { siteInformation } from './site-information'

type AudioBlob = Blob & { audioBuffer?: AudioBuffer }

interface SoundPackConfig {
  url: string
  matchFiles: string[]
  files?: Record<string, AudioBlob>
  soundPack?: Blob
  matchData?: SoundMatch[]
  dwemBgmData?: BgmEntry[]
  dwemBgmTriggerData?: BgmTriggerEntry[]
}

interface SoundConfig {
  soundOn: boolean
  soundVolume: number
  bgmVolume: number
  soundFadeTime: number
  oneSDLSoundChannel: boolean
  soundDebug: boolean
  soundPackConfigList: SoundPackConfig[]
  dwemBgmData: BgmEntry[]
  dwemBgmTriggerData: BgmTriggerEntry[]
  fileIndex: Record<string, AudioBlob>
}

interface SoundMatch {
  regex: RegExp
  path: string
}

interface BgmEntry {
  place: string
  placeKey: string
  depth: number | null
  weight: number
  path: string
}

interface BgmTriggerEntry {
  trigger: string
  weight: number
  path: string
}

interface LoadedSoundPack {
  soundPack: Blob
  files: Record<string, AudioBlob>
}

export class SoundSupport {
  private readonly dbName = 'SoundPackDB'
  private readonly storeName = 'soundPacks'
  private readonly dbReady: Promise<IDBDatabase>
  private readonly soundManager = new SoundManager()
  private installed = false
  private soundConfig: SoundConfig | null = null
  private currentBgmPath: string | null = null
  private playerPlace: string | null = null
  private playerDepthRaw: number | null = null
  private playerOrbHeld = false
  private bgmContextKey: string | null = null
  private bgmRequestId = 0

  constructor() {
    this.dbReady = this.openDB()
  }

  onLoad(): void {
    if (this.installed) return
    this.installed = true
    this.installCommands()

    rcManager.addHandlers('sound-support-rc-handler', {
      onGameInitialize: (rcfile) => this.initializeForGame(rcfile),
      onGameEnd: () => this.unloadForGame(),
    })
  }

  private installCommands(): void {
    commandManager.addCommand('/SoundSupport list', [], async () => {
      const soundPacks = await this.getSoundPacks()
      const list = soundPacks.map((pack, index) => `[${index + 1}] ${escapeHtml(pack.url)}`).join('<br>') || '(none)'
      this.sendChatMessage(`<b>[SoundSupport]</b> Local Sound Packs:<br>${list}`)
    }, { module: SoundSupport.name, description: 'List all local sound packs', aliases: ['/ss list'] })

    commandManager.addCommand('/SoundSupport register', [], async () => {
      await this.registerSoundPack()
      this.sendChatMessage('<b>[SoundSupport]</b> Sound pack registered successfully.')
    }, { module: SoundSupport.name, description: 'Register local sound pack', aliases: ['/ss register'] })

    commandManager.addCommand('/SoundSupport remove', ['string'], async (url) => {
      if (typeof url !== 'string') return
      await this.removeSoundPack(url)
      this.sendChatMessage(`<b>[SoundSupport]</b> Sound pack removed: ${escapeHtml(url)}`)
    }, { module: SoundSupport.name, description: 'Remove local sound pack', argDescriptions: ['URL'], aliases: ['/ss remove'] })

    commandManager.addCommand('/SoundSupport clear', [], async () => {
      await this.clearSoundPacks()
      this.sendChatMessage('<b>[SoundSupport]</b> All sound packs cleared.')
    }, { module: SoundSupport.name, description: 'Clear all local sound packs', aliases: ['/ss clear'] })

    commandManager.addCommand('/SoundSupport volume', ['text'], (text) => {
      this.setVolumeCommand(typeof text === 'string' ? text : '')
    }, { module: SoundSupport.name, description: 'Set FX/BGM volume', argDescriptions: ['0-1 | fx 0-1 | bgm 0-1'], aliases: ['/ss volume', '/sv'] })

    commandManager.addCommand('/SoundSupport reload', [], async () => {
      if (!this.soundConfig) return
      for (const config of this.soundConfig.soundPackConfigList) await this.removeSoundPack(config.url)
      await this.loadSoundPacks()
    }, { module: SoundSupport.name, description: 'Force reload sound pack', aliases: ['/ss reload'] })

    commandManager.addCommand('/SoundSupport test', ['text'], (text) => {
      ioHook.handle_message({ msg: 'msgs', messages: [{ text: String(text ?? '') }] })
    }, { module: SoundSupport.name, description: 'Output a message for sound testing', argDescriptions: ['message'], aliases: ['/ss test'] })

    commandManager.addCommand('/SoundSupport', [], () => {
      const list = commandManager.getCommandsByModule(SoundSupport.name).filter((cmd) => cmd.command !== '/SoundSupport')
      this.sendChatMessage(`<b>[SoundSupport]</b><br>${commandManager.generateHelpHTML(list)}`)
    }, { module: SoundSupport.name, description: 'Show SoundSupport commands', aliases: ['/ss'] })
  }

  private initializeForGame(rcfile: string): void {
    const queue: IncomingMessage[] = []
    ioHook.handle_message.before.addHandler('sound-support-save-msgs', (data) => {
      if (data.msg === 'msgs' || data.msg === 'player' || data.msg === 'ui-push' || data.msg === 'go_lobby' || data.msg === 'game_ended') {
        queue.push(structuredClone(data))
      }
      return false
    }, 2)

    this.soundConfig = this.getSoundConfig(rcfile)
    this.stopBgm()
    this.playerPlace = null
    this.playerDepthRaw = null
    this.playerOrbHeld = false

    void this.loadSoundPacks().then(() => {
      ioHook.handle_message.before.removeHandler('sound-support-save-msgs')
      if (!this.soundConfig?.soundOn || siteInformation.current_hash === '#lobby') return

      ioHook.handle_message.before.addHandler('sound-support-sound-handler', (data) => {
        if (data.msg === 'msgs' && Array.isArray(data.messages)) void this.handleSoundMessage(data)
        return false
      }, 1)
      ioHook.handle_message.before.addHandler('sound-support-bgm-handler', (data) => {
        if (data.msg === 'player' || data.msg === 'ui-push' || data.msg === 'go_lobby' || data.msg === 'game_ended') this.handleBgmMessage(data)
        return false
      }, 1)

      for (const data of queue) {
        if (data.msg === 'msgs' && Array.isArray(data.messages)) void this.handleSoundMessage(data)
        if (data.msg === 'player' || data.msg === 'ui-push' || data.msg === 'go_lobby' || data.msg === 'game_ended') this.handleBgmMessage(data)
      }
    }).catch((err) => {
      ioHook.handle_message.before.removeHandler('sound-support-save-msgs')
      this.sendMessage(`<cyan>[SoundSupport]</cyan> <red>${escapeHtml(err instanceof Error ? err.message : String(err))}</red>`)
    })
  }

  private unloadForGame(): void {
    ioHook.handle_message.before.removeHandler('sound-support-save-msgs')
    ioHook.handle_message.before.removeHandler('sound-support-sound-handler')
    ioHook.handle_message.before.removeHandler('sound-support-bgm-handler')
    this.stopBgm()
  }

  private getSoundConfig(rcfile: string): SoundConfig {
    const soundOn = Boolean(rcManager.getRCOption(rcfile, 'sound_on', 'boolean') || rcManager.getRCOption(rcfile, 'sounds_on', 'boolean'))
    const soundVolume = rcManager.getRCOption(rcfile, 'sound_volume', 'float', 1) as number
    const bgmVolume = rcManager.getRCOption(rcfile, 'bgm_volume', 'float', soundVolume) as number
    const soundFadeTime = rcManager.getRCOption(rcfile, 'sound_fade_time', 'float', 0.5) as number
    const oneSDLSoundChannel = Boolean(rcManager.getRCOption(rcfile, 'one_SDL_sound_channel', 'boolean'))
    const soundDebug = Boolean(rcManager.getRCOption(rcfile, 'sound_debug', 'boolean'))
    const soundPackConfigList = [...rcfile.matchAll(/^(?!\s*#).*sound_pack\s*\+=\s*(.+)$/gm)].map((match) => {
      const parts = match[1].trim().split(/:(?!\/\/)/)
      let matchFiles: string[] = []
      if (parts[1]) {
        try {
          const parsed = JSON.parse(parts.slice(1).join(':'))
          if (Array.isArray(parsed)) matchFiles = parsed.map(String)
        } catch (err) {
          console.warn('[DWEM][SoundSupport] invalid sound_pack match file list', err)
        }
      }
      return { url: parts[0], matchFiles }
    })

    return {
      soundOn,
      soundVolume,
      bgmVolume,
      soundFadeTime,
      oneSDLSoundChannel,
      soundDebug,
      soundPackConfigList,
      dwemBgmData: [],
      dwemBgmTriggerData: [],
      fileIndex: {},
    }
  }

  private getMatchResult(rcfile: string, initialSoundFilePath = ''): { matchData: SoundMatch[]; bgmData: BgmEntry[]; bgmTriggerData: BgmTriggerEntry[]; soundFilePath: string } {
    const matchData: SoundMatch[] = []
    const bgmData: BgmEntry[] = []
    const bgmTriggerData: BgmTriggerEntry[] = []
    let soundFilePath = initialSoundFilePath

    for (const rawLine of rcfile.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue

      const parsedPath = this.parseSoundFilePath(line)
      if (parsedPath !== null) {
        soundFilePath = parsedPath
        continue
      }

      if (line.startsWith('dwem_bgm_trigger')) {
        const parsed = this.parseBgmArgs(line)
        if (!parsed) continue
        const weight = parseFloat(parsed.weightText)
        if (!Number.isFinite(weight) || weight < 0) continue
        bgmTriggerData.push({
          trigger: stripQuotes(parsed.nameText).trim().toLowerCase(),
          weight,
          path: buildAudioPath(soundFilePath, parsed.pathText),
        })
        continue
      }

      if (line.startsWith('dwem_bgm')) {
        const parsed = this.parseBgmArgs(line)
        if (!parsed) continue
        const weight = parseFloat(parsed.weightText)
        if (!Number.isFinite(weight) || weight < 0) continue
        const placeParsed = parsePlaceWithDepth(stripQuotes(parsed.nameText))
        bgmData.push({
          place: placeParsed.place,
          placeKey: normalizePlaceKey(placeParsed.place),
          depth: placeParsed.depth,
          weight,
          path: buildAudioPath(soundFilePath, parsed.pathText),
        })
        continue
      }

      if (!/^\s*sound\s*[+^]=\s*.+$/.test(line)) continue
      try {
        const [regexText, pathText = ''] = line.split(/[+^]=/)[1].trim().split(/(?<!\\):/)
        matchData.push({ regex: new RegExp(regexText), path: buildAudioPath(soundFilePath, pathText) })
      } catch (err) {
        console.warn('[DWEM][SoundSupport] invalid sound line', rawLine, err)
      }
    }

    return { matchData, bgmData, bgmTriggerData, soundFilePath }
  }

  private parseSoundFilePath(line: string): string | null {
    const match = line.match(/^sound_file_path\s*=\s*(.*?)\s*$/)
    if (!match) return null
    const path = stripQuotes(match[1].split('#')[0].trim()).trim()
    return path && !path.endsWith('/') ? path + '/' : path
  }

  private parseBgmArgs(line: string): { nameText: string; weightText: string; pathText: string } | null {
    const open = line.indexOf('(')
    const close = line.lastIndexOf(')')
    if (open < 0 || close <= open) return null
    const parts: string[] = []
    let current = ''
    let quote: string | null = null
    let escaping = false
    for (const char of line.slice(open + 1, close)) {
      if (escaping) {
        current += char
        escaping = false
      } else if (char === '\\') {
        current += char
        escaping = true
      } else if (quote) {
        current += char
        if (char === quote) quote = null
      } else if (char === '"' || char === "'") {
        if (current.trim().length === 0) quote = char
        current += char
      } else if (char === ',') {
        parts.push(current)
        current = ''
      } else {
        current += char
      }
    }
    parts.push(current)
    if (parts.length < 3) return null
    return { nameText: parts[0].trim(), weightText: parts[1].trim(), pathText: parts.slice(2).join(',').trim() }
  }

  private async handleSoundMessage(data: IncomingMessage): Promise<void> {
    if (!this.soundConfig?.soundOn || !Array.isArray(data.messages)) return
    for (const message of data.messages) {
      const rawText = String(message?.text ?? '').replace(/<.+?>/g, '')
      if (!rawText) continue
      for (const config of this.soundConfig.soundPackConfigList) {
        const match = config.matchData?.find((entry) => rawText.match(entry.regex))
        if (!match || !config.files) continue
        const file = config.files[match.path]
        if (!file) {
          if (this.soundConfig.soundDebug) console.warn('[DWEM][SoundSupport] matched missing sound file', match.path)
          continue
        }
        if (this.soundConfig.soundDebug) console.log('[DWEM][SoundSupport]', rawText, match.regex, match.path)
        const audioBuffer = file.audioBuffer ?? await this.soundManager.blobToAudioBuffer(file)
        file.audioBuffer = audioBuffer
        if (this.soundConfig.oneSDLSoundChannel) this.soundManager.stop()
        await this.soundManager.play(audioBuffer)
        break
      }
    }
  }

  private handleBgmMessage(data: IncomingMessage): void {
    if (!this.soundConfig?.soundOn) return
    if (data.msg === 'player') {
      this.handlePlayerMessage(data)
    } else if (data.msg === 'ui-push' && data.type === 'game-over') {
      this.bgmContextKey = 'trigger:endgame'
      this.playBgmTrigger('EndGame')
    } else if (data.msg === 'go_lobby' || data.msg === 'game_ended') {
      this.stopBgm()
      this.playerPlace = null
      this.playerDepthRaw = null
      this.playerOrbHeld = false
    }
  }

  private handlePlayerMessage(data: IncomingMessage): void {
    const previousPlace = this.playerPlace
    const previousDepthRaw = this.playerDepthRaw
    const previousOrbHeld = this.playerOrbHeld

    if (typeof data.place === 'string') {
      const parsed = parsePlaceWithDepth(stripQuotes(data.place))
      if (parsed.place) this.playerPlace = parsed.place
      if ((data.depth === undefined || data.depth === null) && parsed.depth !== null) {
        this.playerDepthRaw = normalizeDepthRaw(parsed.depth)
      }
    }
    if (data.depth !== undefined && data.depth !== null) {
      this.playerDepthRaw = normalizeDepthRaw(Number(data.depth))
    }

    if (Array.isArray(data.status)) {
      this.playerOrbHeld = data.status.some((entry: Record<string, unknown>) => {
        const light = String(entry.light ?? entry.text ?? '').replace(/<[^>]*>/g, '').trim().toLowerCase()
        const desc = String(entry.desc ?? '').replace(/<[^>]*>/g, '').trim().toLowerCase()
        return light === 'orb' && Number(entry.col) === 13 && !desc.includes('charlatan')
      })
    }

    if (!this.playerPlace) return
    if (!previousOrbHeld && this.playerOrbHeld) {
      this.bgmContextKey = 'trigger:orb'
      this.playBgmTrigger('Orb')
      return
    }
    if (this.playerOrbHeld) return
    if (this.playerPlace === previousPlace && this.playerDepthRaw === previousDepthRaw) return
    this.playBgmForPlace(this.playerPlace, this.playerDepthRaw)
  }

  private playBgmTrigger(triggerName: string): void {
    if (!this.soundConfig) return
    const candidates = this.soundConfig.dwemBgmTriggerData.filter((entry) => entry.trigger === triggerName.toLowerCase())
    const selected = pickWeighted(candidates)
    if (!selected) return
    if (this.currentBgmPath === selected.path && this.soundManager.currentlyLoopingBgm) return
    void this.setBgm(selected.path)
  }

  private playBgmForPlace(place: string, depthRaw: number | null): void {
    if (!this.soundConfig) return
    const placeKey = normalizePlaceKey(place)
    const depthParsed = normalizeDepthRaw(depthRaw)
    const normalizedDepth = normalizeDepth(depthParsed)
    const isStartGame = placeKey === 'dungeon' && depthParsed === 0
    const contextKey = isStartGame ? `${placeKey}:0` : normalizedDepth !== null ? `${placeKey}:${normalizedDepth}` : placeKey
    if (contextKey === this.bgmContextKey) return
    this.bgmContextKey = contextKey
    if (isStartGame) {
      this.playBgmTrigger('StartGame')
      return
    }

    const candidates = this.soundConfig.dwemBgmData.filter((entry) => {
      if (entry.placeKey !== placeKey) return false
      return entry.depth === null || (normalizedDepth !== null && entry.depth === normalizedDepth)
    })
    const selected = pickWeighted(candidates)
    if (!selected) {
      this.currentBgmPath = null
      this.soundManager.stopBgm()
      return
    }
    if (this.currentBgmPath === selected.path && this.soundManager.currentlyLoopingBgm) return
    void this.setBgm(selected.path)
  }

  private async setBgm(soundPath: string): Promise<void> {
    if (!this.soundConfig) return
    const requestId = ++this.bgmRequestId
    const selected = this.resolveBgmBlob(soundPath)
    if (!selected) return
    const audioBuffer = selected.audioBuffer ?? await this.soundManager.blobToAudioBuffer(selected)
    selected.audioBuffer = audioBuffer
    if (requestId !== this.bgmRequestId) return
    this.currentBgmPath = soundPath
    await this.soundManager.playLoop(audioBuffer)
  }

  private resolveBgmBlob(soundPath: string): AudioBlob | null {
    if (!this.soundConfig) return null
    const normalized = buildAudioPath('', soundPath).replace(/^\/+/, '')
    const direct = this.soundConfig.fileIndex[normalized]
    if (direct) return direct
    const basename = normalized.split('/').pop()
    if (!basename) return null
    const key = Object.keys(this.soundConfig.fileIndex).find((candidate) => candidate === basename || candidate.endsWith(`/${basename}`))
    return key ? this.soundConfig.fileIndex[key] : null
  }

  private stopBgm(): void {
    this.bgmRequestId += 1
    this.currentBgmPath = null
    this.bgmContextKey = null
    this.soundManager.stopBgm()
  }

  private async loadSoundPacks(): Promise<void> {
    if (!this.soundConfig?.soundOn) return
    const config = this.soundConfig
    this.soundManager.volume = config.soundVolume
    this.soundManager.bgmVolume = config.bgmVolume
    this.soundManager.fadeTime = config.soundFadeTime
    this.stopBgm()
    config.dwemBgmData = []
    config.dwemBgmTriggerData = []
    config.fileIndex = {}

    let totalBytes = 0
    let totalMatchData = 0
    let totalBgmData = 0
    for (const soundPackConfig of config.soundPackConfigList) {
      let loaded: LoadedSoundPack
      try {
        loaded = await this.getSoundPack(soundPackConfig.url)
      } catch {
        this.sendMessage(`<cyan>[SoundSupport]</cyan> Download sound pack: ${escapeHtml(soundPackConfig.url)}`)
        await this.downloadSoundPack(soundPackConfig.url)
        loaded = await this.getSoundPack(soundPackConfig.url)
      }

      soundPackConfig.files = loaded.files
      soundPackConfig.soundPack = loaded.soundPack
      totalBytes += loaded.soundPack.size

      let txtFiles = Object.keys(loaded.files)
      txtFiles = soundPackConfig.matchFiles.length === 0
        ? txtFiles.filter((name) => name.endsWith('.txt'))
        : soundPackConfig.matchFiles.filter((name) => txtFiles.includes(name))

      let soundFilePath = ''
      const allMatchData: SoundMatch[] = []
      const allBgmData: BgmEntry[] = []
      const allBgmTriggerData: BgmTriggerEntry[] = []
      for (const key of txtFiles) {
        const text = await loaded.files[key].text()
        const result = this.getMatchResult(text, soundFilePath)
        soundFilePath = result.soundFilePath
        allMatchData.push(...result.matchData)
        allBgmData.push(...result.bgmData)
        allBgmTriggerData.push(...result.bgmTriggerData)
      }

      soundPackConfig.matchData = allMatchData
      soundPackConfig.dwemBgmData = allBgmData
      soundPackConfig.dwemBgmTriggerData = allBgmTriggerData
      config.dwemBgmData.push(...allBgmData)
      config.dwemBgmTriggerData.push(...allBgmTriggerData)
      totalMatchData += allMatchData.length
      totalBgmData += allBgmData.length

      for (const [path, file] of Object.entries(loaded.files)) {
        config.fileIndex[path] ??= file
      }
      if (loaded.files['sound-pack-info']) {
        this.sendMessage(`<cyan>[SoundSupport]</cyan> ${(await loaded.files['sound-pack-info'].text()).trim()}`)
      }
    }

    const mb = Math.floor((totalBytes / (1024 * 1024)) * 10) / 10
    this.sendMessage(`<cyan>[SoundSupport]</cyan> ${config.soundPackConfigList.filter((entry) => entry.soundPack).length} sound pack (${mb} MB), ${totalMatchData} sound + ${totalBgmData} bgm data loaded successfully.`)
  }

  private async getSoundPacks(): Promise<Array<{ url: string; soundPack: Blob }>> {
    const db = await this.dbReady
    return new Promise((resolve, reject) => {
      const request = db.transaction([this.storeName], 'readonly').objectStore(this.storeName).getAll()
      request.onsuccess = () => resolve(request.result as Array<{ url: string; soundPack: Blob }>)
      request.onerror = () => reject(request.error)
    })
  }

  private async registerSoundPack(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.zip'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return reject(new Error('No file selected'))
        try {
          await this.saveSoundPack(`local://${file.name}`, file)
          resolve()
        } catch (err) {
          reject(err)
        }
      }
      input.click()
    })
  }

  private async clearSoundPacks(): Promise<void> {
    const db = await this.dbReady
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction([this.storeName], 'readwrite').objectStore(this.storeName).clear()
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private async removeSoundPack(url: string): Promise<void> {
    const db = await this.dbReady
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction([this.storeName], 'readwrite').objectStore(this.storeName).delete(url)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private async saveSoundPack(url: string, blob: Blob): Promise<void> {
    const db = await this.dbReady
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction([this.storeName], 'readwrite').objectStore(this.storeName).put({ url, soundPack: blob })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private async getSoundPack(url: string): Promise<LoadedSoundPack> {
    const db = await this.dbReady
    const record = await new Promise<{ soundPack: Blob } | undefined>((resolve, reject) => {
      const request = db.transaction([this.storeName], 'readonly').objectStore(this.storeName).get(url)
      request.onsuccess = () => resolve(request.result as { soundPack: Blob } | undefined)
      request.onerror = () => reject(request.error)
    })
    if (!record) throw new Error('Sound pack not found')

    const zip = await JSZip.loadAsync(await record.soundPack.arrayBuffer())
    const files: Record<string, AudioBlob> = {}
    await Promise.all(Object.entries(zip.files).map(async ([path, file]) => {
      if (file.dir) return
      files[path] = await file.async('blob') as AudioBlob
    }))
    return { soundPack: record.soundPack, files }
  }

  private async downloadSoundPack(url: string): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Network response was not ok: HTTP ${response.status}`)
    await this.saveSoundPack(url, await response.blob())
  }

  private setVolumeCommand(text: string): void {
    const parts = text.trim().split(/\s+/).filter(Boolean)
    const parseVolume = (value: string): number | null => {
      const parsed = parseFloat(value)
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null
    }
    const usage = (): void => {
      this.sendChatMessage('<b>[SoundSupport]</b> Usage: /SoundSupport volume 0-1 | /SoundSupport volume fx 0-1 | /SoundSupport volume bgm 0-1')
    }
    if (!parts.length) return usage()
    if (parts.length === 1) {
      const volume = parseVolume(parts[0])
      if (volume === null) return usage()
      this.soundManager.volume = volume
      this.soundManager.bgmVolume = volume
      if (this.soundConfig) {
        this.soundConfig.soundVolume = volume
        this.soundConfig.bgmVolume = volume
      }
      this.sendChatMessage(`<b>[SoundSupport]</b> FX+BGM volume set to ${volume}`)
      return
    }
    if (parts.length === 2) {
      const volume = parseVolume(parts[1])
      if (volume === null) return usage()
      if (parts[0].toLowerCase() === 'fx') {
        this.soundManager.volume = volume
        if (this.soundConfig) this.soundConfig.soundVolume = volume
        this.sendChatMessage(`<b>[SoundSupport]</b> FX volume set to ${volume}`)
        return
      }
      if (parts[0].toLowerCase() === 'bgm') {
        this.soundManager.bgmVolume = volume
        this.soundManager.setCurrentBgmVolume(volume)
        if (this.soundConfig) this.soundConfig.bgmVolume = volume
        this.sendChatMessage(`<b>[SoundSupport]</b> BGM volume set to ${volume}`)
        return
      }
    }
    usage()
  }

  private sendMessage(text: string): void {
    ioHook.handle_message({ msg: 'msgs', messages: [{ text }] })
  }

  private sendChatMessage(content: string): void {
    this.sendMessage(content)
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName, { keyPath: 'url' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
}

class SoundManager {
  fadeTime = 0.5
  volume = 1
  bgmVolume = 1
  currentlyLoopingBgm = false

  private context: AudioContext | null = null
  private previousData: { source: AudioBufferSourceNode; gainNode: GainNode } | null = null
  private loopData: { source: AudioBufferSourceNode; gainNode: GainNode } | null = null

  async blobToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
    const context = await this.getContext()
    return context.decodeAudioData(await blob.arrayBuffer())
  }

  async play(buffer: AudioBuffer): Promise<void> {
    const context = await this.getContext()
    const gainNode = context.createGain()
    gainNode.gain.value = this.volume
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(gainNode)
    gainNode.connect(context.destination)
    source.start(0)
    this.previousData = { source, gainNode }
  }

  stop(): void {
    if (!this.previousData || !this.context) return
    const { gainNode } = this.previousData
    gainNode.gain.linearRampToValueAtTime(this.volume, this.context.currentTime)
    gainNode.gain.linearRampToValueAtTime(0, this.context.currentTime + this.fadeTime)
  }

  async playLoop(buffer: AudioBuffer): Promise<void> {
    const context = await this.getContext()
    this.stopBgm()
    const gainNode = context.createGain()
    gainNode.gain.value = this.bgmVolume
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(gainNode)
    gainNode.connect(context.destination)
    source.start(0)
    this.loopData = { source, gainNode }
    this.currentlyLoopingBgm = true
  }

  stopBgm(): void {
    if (!this.loopData) return
    this.loopData.source.stop(0)
    this.loopData = null
    this.currentlyLoopingBgm = false
  }

  setCurrentBgmVolume(volume: number): void {
    if (this.loopData) this.loopData.gainNode.gain.value = volume
  }

  private async getContext(): Promise<AudioContext> {
    this.context ??= new AudioContext()
    if (this.context.state === 'suspended') {
      await this.context.resume().catch(() => undefined)
    }
    return this.context
  }
}

function stripQuotes(text: string): string {
  const trimmed = text.trim()
  return ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1)
    : trimmed
}

function buildAudioPath(basePath: string, filePath: string): string {
  let base = stripQuotes(basePath || '').trim()
  let file = stripQuotes(filePath || '').replace(/\\/g, '/').trim()
  file = file.split('#')[0].trim()
  if (file.startsWith('./')) file = file.slice(2)
  if (!base) return file
  if (!base.endsWith('/')) base += '/'
  return `${base}${file}`
}

function parsePlaceWithDepth(placeText: string): { place: string; depth: number | null } {
  const match = placeText.trim().match(/^(.*)\s*:\s*([0-9]+)$/)
  return match ? { place: match[1].trim(), depth: parseInt(match[2], 10) } : { place: placeText.trim(), depth: null }
}

function normalizePlaceKey(placeText: string): string {
  let text = placeText.trim().toLowerCase()
  text = text.replace(/[’]/g, "'").replace(/'s\b/g, '').replace(/'/g, '').replace(/\s+/g, ' ')
  if (text.startsWith('the ')) text = text.slice(4)
  else if (text.startsWith('an ')) text = text.slice(3)
  else if (text.startsWith('a ')) text = text.slice(2)
  return text.trim()
}

function normalizeDepthRaw(depth: number | null): number | null {
  if (depth === null) return null
  const parsed = parseInt(String(depth), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizeDepth(depth: number | null): number | null {
  if (depth === null) return null
  const parsed = parseInt(String(depth), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function pickWeighted<T extends { weight: number }>(entries: T[]): T | null {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0)
  if (!totalWeight) return null
  const random = Math.random() * totalWeight
  let sum = 0
  for (const entry of entries) {
    sum += entry.weight
    if (random <= sum) return entry
  }
  return entries[entries.length - 1] ?? null
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const soundSupport = new SoundSupport()
