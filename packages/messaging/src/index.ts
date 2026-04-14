/**
 * @ordr/messaging — Internal enterprise messaging
 * In-app channels, direct messages, presence, and real-time events.
 */
export type {
  ChannelType,
  MessageContentType,
  PresenceStatus,
  MessageEventType,
  ChatChannel,
  MessageAttachment,
  ChatMessage,
  PresenceRecord,
  TypingIndicator,
  MessageEvent,
  CreateChannelInput,
  SendMessageInput,
  PaginatedMessages,
} from './types.js';
export { ChannelManager, InMemoryChannelStore } from './channel-manager.js';
export type { ChannelStore } from './channel-manager.js';
export { MessageService, InMemoryMessageStore } from './message-store.js';
export type { MessageStore } from './message-store.js';
export { PresenceManager } from './presence.js';
export { DrizzleChannelStore, DrizzleMessageStore } from './drizzle-stores.js';
