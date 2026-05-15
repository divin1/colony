// Minimal channel interface used by the runner and Discord integration.
// DiscordIntegration satisfies this structurally — core does not depend on @colony/discord.

export interface ConfirmationChannel {
  send(channelId: string, content: string): Promise<{ id: string }>;
}
