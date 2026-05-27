import { commandManager } from './command-manager'
import { cncUserinfo } from './cnc-userinfo'
import { ioHook } from './io-hook'
import { rcManager } from './rc-manager'
import { siteInformation, type DwemContext } from './site-information'
import { soundSupport } from './sound-support'
import { translationModule } from './translation-module'

let installed = false

export function installDwem(): void {
  if (installed) return
  installed = true

  commandManager.onLoad()
  cncUserinfo.onLoad()
  rcManager.onLoad()
  soundSupport.onLoad()
  translationModule.onLoad()

  const w = window as unknown as Record<string, unknown>
  w['DWEM'] = {
    Modules: {
      IOHook: ioHook,
      CNCUserinfo: cncUserinfo,
      RCManager: rcManager,
      SiteInformation: siteInformation,
      CommandManager: commandManager,
      SoundSupport: soundSupport,
      TranslationModule: translationModule,
    },
  }
}

export function setDwemContext(ctx: DwemContext): void {
  siteInformation.setContext(ctx)
}

export { ioHook, cncUserinfo, rcManager, siteInformation, commandManager, soundSupport, translationModule }
