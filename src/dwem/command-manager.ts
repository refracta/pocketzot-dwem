import { ioHook } from './io-hook'

type ArgumentType = 'string' | 'integer' | 'float' | 'text' | `${'string' | 'integer' | 'float'}?`
type CommandHandler = (...args: Array<string | number | undefined>) => void | Promise<void>

interface CommandOptions {
  module?: string
  description?: string
  argDescriptions?: string[]
  aliases?: string[]
}

interface CommandEntry {
  command: string
  argumentTypes: ArgumentType[]
  handler: CommandHandler
  module: string
  description: string
  argDescriptions: string[]
  aliases: string[]
}

export class CommandManager {
  private commands: CommandEntry[] = []
  private installed = false

  onLoad(): void {
    if (this.installed) return
    this.installed = true
    ioHook.send_message.before.addHandler('command-manager', (msgName, data) => {
      if (msgName !== 'chat_msg') return false
      const text = String(data.text ?? '').trim()
      const matched = this.findCommand(text)
      if (!matched) return false
      const argsText = text.slice(matched.input.length).trim()
      try {
        const args = this.parseArguments(argsText, matched.command.argumentTypes)
        void matched.command.handler(...args)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.sendChatMessage(`<b>[CommandManager]</b> ${escapeHtml(message)}`)
      }
      return true
    })

    this.addCommand('/help', ['text'], (moduleName) => {
      const moduleText = typeof moduleName === 'string' ? moduleName.trim() : ''
      const list = moduleText ? this.getCommandsByModule(moduleText) : this.commands
      const title = moduleText ? `Available Commands for ${escapeHtml(moduleText)}` : 'Available Commands'
      this.sendChatMessage(`<b>${title}</b><br>${this.generateHelpHTML(list)}`)
    }, {
      module: CommandManager.name,
      description: 'Show command list',
      argDescriptions: ['module'],
    })
  }

  addCommand(command: string, argumentTypes: ArgumentType[], handler: CommandHandler, options: CommandOptions = {}): void {
    const entry: CommandEntry = {
      command,
      argumentTypes,
      handler,
      module: options.module ?? 'Unknown',
      description: options.description ?? '',
      argDescriptions: options.argDescriptions ?? [],
      aliases: options.aliases ?? [],
    }
    this.commands = this.commands.filter((c) => c.command !== command)
    this.commands.push(entry)
  }

  getCommandsByModule(moduleName: string): CommandEntry[] {
    return this.commands.filter((cmd) => cmd.module === moduleName)
  }

  generateHelpHTML(commands: CommandEntry[]): string {
    return commands
      .map((cmd) => {
        const args = cmd.argDescriptions.length ? ` ${cmd.argDescriptions.map((d) => `[${escapeHtml(d)}]`).join(' ')}` : ''
        return `/<b>${escapeHtml(cmd.command.replace(/^\//, ''))}</b>${args} - ${escapeHtml(cmd.description)}`
      })
      .join('<br>')
  }

  sendChatMessage(content: string): void {
    ioHook.handle_message({
      msg: 'msgs',
      messages: [{ text: content }],
    })
  }

  private findCommand(text: string): { command: CommandEntry; input: string } | null {
    const candidates = this.commands.flatMap((command) => [
      { command, input: command.command },
      ...command.aliases.map((alias) => ({ command, input: alias })),
    ])
    candidates.sort((a, b) => b.input.length - a.input.length)
    return candidates.find((candidate) => (
      text === candidate.input || text.startsWith(candidate.input + ' ')
    )) ?? null
  }

  private parseArguments(text: string, argumentTypes: ArgumentType[]): Array<string | number | undefined> {
    const parts = text ? text.split(/\s+/).filter(Boolean) : []
    const parsed: Array<string | number | undefined> = []
    let argIndex = 0

    for (const rawType of argumentTypes) {
      const optional = rawType.endsWith('?')
      const type = (optional ? rawType.slice(0, -1) : rawType) as 'string' | 'integer' | 'float' | 'text'

      if (type === 'text') {
        parsed.push(parts.slice(argIndex).join(' '))
        argIndex = parts.length
        continue
      }

      const value = parts[argIndex]
      argIndex += 1
      if (value === undefined) {
        if (optional) {
          parsed.push(undefined)
          continue
        }
        throw new Error(`Missing required argument for type: ${type}`)
      }

      if (type === 'integer') {
        const intValue = parseInt(value, 10)
        if (!Number.isFinite(intValue)) throw new Error(`Invalid integer value: ${value}`)
        parsed.push(intValue)
      } else if (type === 'float') {
        const floatValue = parseFloat(value)
        if (!Number.isFinite(floatValue)) throw new Error(`Invalid float value: ${value}`)
        parsed.push(floatValue)
      } else {
        parsed.push(value)
      }
    }

    return parsed
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const commandManager = new CommandManager()
