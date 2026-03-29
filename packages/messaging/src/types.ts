/**
 * @ordr/messaging — Internal enterprise messaging types
 */
export type ChannelType = 'public' | 'private' | 'direct' | 'announcement' | 'thread';
export type MessageContentType = 'text' | 'markdown' | 'file' | 'image' | 'system' | 'code';
export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline';
export type MessageEventType =
  | 'message.new'
  | 'message.edit'
  | 'message.delete'
  | 'message.reaction'
  | 'channel.created'
  | 'channel.updated'
  | 'channel.deleted'
  | 'channel.member_joined'
  | 'channel.member_left'
  | 'presence.update'
  | 'typing.start'
  | 'typing.stop'
  | 'thread.reply'
  | 'read.receipt';

export interface ChatChannel {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly type: ChannelType;
  readonly description?: string;
  readonly topic?: string;
  readonly memberIds: readonly string[];
  readonly adminIds: readonly string[];
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly isArchived: boolean;
  readonly isPinned: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface MessageAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly mimeType: string;
  readonly url: string; // Signed URL, expires
  readonly thumbnailUrl?: string;
}

export interface ChatMessage {
  readonly id: string;
  readonly channelId: string;
  readonly tenantId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly senderAvatar?: string;
  readonly content: string;
  readonly contentType: MessageContentType;
  readonly attachments: readonly MessageAttachment[];
  readonly replyToId?: string;
  readonly threadId?: string;
  readonly threadReplyCount?: number;
  readonly mentions: readonly string[]; // userIds
  readonly reactions: Record<string, readonly string[]>; // emoji -> userIds
  readonly readBy: Record<string, string>; // userId -> ISO timestamp
  readonly editedAt?: Date;
  readonly deletedAt?: Date;
  readonly isSystemMessage: boolean;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface PresenceRecord {
  readonly userId: string;
  readonly tenantId: string;
  readonly status: PresenceStatus;
  readonly statusMessage?: string;
  readonly lastSeen: Date;
  readonly activeChannelId?: string;
}

export interface TypingIndicator {
  readonly channelId: string;
  readonly userId: string;
  readonly userName: string;
  readonly startedAt: number; // epoch ms
}

export interface MessageEvent {
  readonly type: MessageEventType;
  readonly tenantId: string;
  readonly channelId?: string;
  readonly userId?: string;
  readonly payload: unknown;
  readonly timestamp: Date;
}

export interface CreateChannelInput {
  readonly tenantId: string;
  readonly name: string;
  readonly type: ChannelType;
  readonly description?: string;
  readonly memberIds: readonly string[];
  readonly createdBy: string;
}

export interface SendMessageInput {
  readonly channelId: string;
  readonly tenantId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly content: string;
  readonly contentType?: MessageContentType;
  readonly replyToId?: string;
  readonly mentions?: readonly string[];
}

export interface PaginatedMessages {
  readonly messages: readonly ChatMessage[];
  readonly hasMore: boolean;
  readonly cursor?: string;
}
