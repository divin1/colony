// Minimal channel interface used by the runner and Discord integration.
// DiscordIntegration satisfies this structurally — core does not depend on @colony/discord.

export interface ConfirmationChannel {
  send(channelId: string, content: string): Promise<{ id: string }>;
  addReaction(messageId: string, emoji: string): Promise<void>;
  waitForReaction(
    messageId: string,
    options: { timeout: number; allowedEmojis: string[]; channelId?: string }
  ): Promise<string | null>;
}
