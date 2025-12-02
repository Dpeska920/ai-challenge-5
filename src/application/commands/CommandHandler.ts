import type { User } from '../../domain/entities/User';
import type { SendMessageOptions } from '../handlers/MessageHandler';

export interface CommandContext {
  user: User;
  telegramId: number;
  sendMessage: (text: string, options?: SendMessageOptions) => Promise<void>;
  args: string[];
}

export interface Command {
  name: string;
  description: string;
  execute(ctx: CommandContext): Promise<void>;
}

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();

  register(command: Command): void {
    this.commands.set(command.name.toLowerCase(), command);
  }

  get(name: string): Command | undefined {
    return this.commands.get(name.toLowerCase());
  }

  has(name: string): boolean {
    return this.commands.has(name.toLowerCase());
  }

  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  getAllDescriptions(): { name: string; description: string }[] {
    return this.getAll().map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
  }
}

export const commandRegistry = new CommandRegistry();
