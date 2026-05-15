import {
  Client,
  GatewayIntentBits,
  type Message,
} from "discord.js";

export interface SentMessage {
  id: string;
}

export interface DiscordConfig {
  token: string;
  guild: string;
}

export interface DiscordCommandPayload {
  channelId: string;
  content: string;
  author: string;
}

export interface MessagingIntegration {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on<T>(event: string, handler: (payload: T) => void): void;
  send(channelId: string, content: string): Promise<SentMessage>;
}

export class DiscordIntegration implements MessagingIntegration {
  private client: Client;
  private token: string;
  private guildNameOrId: string;
  // Colony-level event handlers (e.g. "discord_command") separate from raw discord.js events.
  private eventHandlers = new Map<string, Array<(payload: unknown) => void>>();

  constructor(config: DiscordConfig) {
    this.token = config.token;
    this.guildNameOrId = config.guild;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.once("clientReady", () => {
        this.client.on("messageCreate", (message: Message) => {
          if (message.author.bot) return;
          const payload: DiscordCommandPayload = {
            channelId: message.channelId,
            content: message.content,
            author: message.author.username,
          };
          this.emit("discord_command", payload);
        });
        resolve();
      });
      this.client.once("error", reject);
      this.client.login(this.token).catch(reject);
    });
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
  }

  // Register a handler for colony-level events (e.g. "discord_command").
  on<T>(event: string, handler: (payload: T) => void): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler as (payload: unknown) => void);
    this.eventHandlers.set(event, handlers);
  }

  emit(event: string, payload: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const h of handlers) h(payload);
    }
  }

  async send(channelId: string, content: string): Promise<SentMessage> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      throw new Error(`Channel ${channelId} is not a text-based channel`);
    }
    const message = await channel.send(content);
    return { id: message.id };
  }

  // Resolve a channel name or ID to a channel ID within the configured guild.
  // Used by the runner to translate ant config channel names to Discord channel IDs.
  async resolveChannelId(nameOrId: string): Promise<string> {
    const guild = this.client.guilds.cache.find(
      (g) => g.name === this.guildNameOrId || g.id === this.guildNameOrId
    );
    if (!guild) {
      throw new Error(`Guild not found: ${this.guildNameOrId}`);
    }
    const channels = await guild.channels.fetch();
    const channel = channels.find(
      (c) => c?.name === nameOrId || c?.id === nameOrId
    );
    if (!channel) {
      throw new Error(
        `Channel not found in guild "${guild.name}": ${nameOrId}`
      );
    }
    return channel.id;
  }
}
