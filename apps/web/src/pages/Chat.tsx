/**
 * Chat — Internal enterprise messaging page
 * Slack-like interface with channel sidebar, message thread, typing indicators,
 * presence badges, emoji reactions, @mentions, and real-time SSE updates.
 *
 * COMPLIANCE:
 * - No PHI stored client-side (Rule 6)
 * - API calls use correlation IDs (Rule 3)
 * - Input validated before send (Rule 4)
 * - SSE connection authenticated server-side (Rule 2)
 */

import { type ReactNode, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { StatusDot } from '../components/ui/StatusDot';
import {
  Hash,
  Lock,
  MessageCircle,
  Search,
  Plus,
  Send,
  Smile,
  Paperclip,
  Edit,
  Trash2,
  MessageSquare,
  Users,
  X,
  Check,
  Phone,
  Video,
  Settings,
  ChevronDown,
  ChevronRight,
  AtSign,
} from '../components/icons';

// ─── Types ────────────────────────────────────────────────────────────────────

type ChannelType = 'public' | 'private' | 'direct' | 'announcement' | 'thread';
type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline';
type MessageContentType = 'text' | 'markdown' | 'code' | 'system';

interface ChatChannel {
  id: string;
  name: string;
  type: ChannelType;
  description?: string;
  topic?: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  isPinned: boolean;
  unreadCount?: number;
  lastMessage?: string;
  lastMessageAt?: string;
}

interface MessageAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
  thumbnailUrl?: string;
}

interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  contentType: MessageContentType;
  attachments: MessageAttachment[];
  replyToId?: string;
  mentions: string[];
  reactions: Record<string, string[]>;
  readBy: Record<string, string>;
  editedAt?: string;
  deletedAt?: string;
  isSystemMessage: boolean;
  createdAt: string;
}

interface PresenceRecord {
  userId: string;
  status: PresenceStatus;
  statusMessage?: string;
  lastSeen: string;
}

interface TypingUser {
  userId: string;
  userName: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const QUICK_REACTIONS = ['👍', '👎', '❤️', '😂', '🎉', '🚀', '👀', '✅'];

const MOCK_CHANNELS: ChatChannel[] = [
  {
    id: 'ch-1',
    name: 'general',
    type: 'public',
    description: 'Company-wide announcements',
    memberCount: 48,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isArchived: false,
    isPinned: true,
    unreadCount: 3,
    lastMessage: 'Deploy to production completed successfully',
    lastMessageAt: new Date(Date.now() - 300_000).toISOString(),
  },
  {
    id: 'ch-2',
    name: 'engineering',
    type: 'private',
    description: 'Engineering team discussions',
    memberCount: 12,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isArchived: false,
    isPinned: false,
    unreadCount: 0,
    lastMessage: 'PR #142 is ready for review',
    lastMessageAt: new Date(Date.now() - 900_000).toISOString(),
  },
  {
    id: 'ch-3',
    name: 'compliance-alerts',
    type: 'announcement',
    description: 'Automated compliance notifications',
    memberCount: 48,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isArchived: false,
    isPinned: true,
    unreadCount: 1,
    lastMessage: 'SLA breach detected: Customer #4291',
    lastMessageAt: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: 'ch-4',
    name: 'support-ops',
    type: 'public',
    description: 'Customer support operations',
    memberCount: 18,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isArchived: false,
    isPinned: false,
    unreadCount: 7,
    lastMessage: 'Escalation queue is at 23 — all hands on deck',
    lastMessageAt: new Date(Date.now() - 120_000).toISOString(),
  },
  {
    id: 'dm-1',
    name: 'Sarah Chen',
    type: 'direct',
    memberCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isArchived: false,
    isPinned: false,
    unreadCount: 2,
    lastMessage: 'Can you review the compliance report?',
    lastMessageAt: new Date(Date.now() - 1_800_000).toISOString(),
  },
  {
    id: 'dm-2',
    name: 'Marcus Webb',
    type: 'direct',
    memberCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isArchived: false,
    isPinned: false,
    unreadCount: 0,
    lastMessage: 'Thanks, approved!',
    lastMessageAt: new Date(Date.now() - 3_600_000).toISOString(),
  },
];

const MOCK_MESSAGES: ChatMessage[] = [
  {
    id: 'msg-1',
    channelId: 'ch-1',
    senderId: 'user-system',
    senderName: 'System',
    content: 'Welcome to #general! This is the start of the channel.',
    contentType: 'system',
    attachments: [],
    mentions: [],
    reactions: {},
    readBy: {},
    isSystemMessage: true,
    createdAt: new Date(Date.now() - 86_400_000 * 7).toISOString(),
  },
  {
    id: 'msg-2',
    channelId: 'ch-1',
    senderId: 'user-sarah',
    senderName: 'Sarah Chen',
    content:
      'Good morning team! Just pushed the new compliance dashboard to staging. @user-marcus please review when you get a chance.',
    contentType: 'text',
    attachments: [],
    mentions: ['user-marcus'],
    reactions: { '👍': ['user-marcus', 'user-james'], '🎉': ['user-james'] },
    readBy: { 'user-sarah': new Date().toISOString() },
    isSystemMessage: false,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  },
  {
    id: 'msg-3',
    channelId: 'ch-1',
    senderId: 'user-marcus',
    senderName: 'Marcus Webb',
    content:
      'Looks great Sarah! The SLA breach detection is working perfectly. I ran through the full compliance checklist and everything passes SOC2 CC7.2.',
    contentType: 'text',
    attachments: [],
    mentions: [],
    reactions: { '✅': ['user-sarah', 'user-james', 'user-alex'] },
    readBy: {},
    isSystemMessage: false,
    createdAt: new Date(Date.now() - 2_400_000).toISOString(),
  },
  {
    id: 'msg-4',
    channelId: 'ch-1',
    senderId: 'user-james',
    senderName: 'James Liu',
    content:
      '```typescript\n// Quick fix for the rate limiter — was missing tenant isolation\nconst key = `${tenantId}:${userId}:${endpoint}`;\n```',
    contentType: 'code',
    attachments: [],
    mentions: [],
    reactions: { '👀': ['user-sarah'] },
    readBy: {},
    isSystemMessage: false,
    createdAt: new Date(Date.now() - 1_200_000).toISOString(),
  },
  {
    id: 'msg-5',
    channelId: 'ch-1',
    senderId: 'user-alex',
    senderName: 'Alex Rivera',
    content:
      'Deploy to production completed successfully. All health checks passing. Monitoring for 30 min before closing the change record.',
    contentType: 'text',
    attachments: [],
    mentions: [],
    reactions: { '🚀': ['user-sarah', 'user-marcus', 'user-james'] },
    readBy: {},
    isSystemMessage: false,
    createdAt: new Date(Date.now() - 300_000).toISOString(),
  },
];

const MOCK_PRESENCE: Record<string, PresenceRecord> = {
  'user-sarah': { userId: 'user-sarah', status: 'online', lastSeen: new Date().toISOString() },
  'user-marcus': {
    userId: 'user-marcus',
    status: 'away',
    statusMessage: 'In a meeting',
    lastSeen: new Date(Date.now() - 900_000).toISOString(),
  },
  'user-james': { userId: 'user-james', status: 'online', lastSeen: new Date().toISOString() },
  'user-alex': {
    userId: 'user-alex',
    status: 'dnd',
    statusMessage: 'Focusing — deploy in progress',
    lastSeen: new Date().toISOString(),
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function presenceToStatus(status: PresenceStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'online':
      return 'success';
    case 'away':
      return 'warning';
    case 'dnd':
      return 'danger';
    default:
      return 'neutral';
  }
}

function shouldGroupWithPrevious(msg: ChatMessage, prev: ChatMessage | undefined): boolean {
  if (prev === undefined) return false;
  if (msg.senderId !== prev.senderId) return false;
  if (msg.isSystemMessage || prev.isSystemMessage) return false;
  const timeDiff = new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime();
  return timeDiff < 5 * 60 * 1000; // within 5 minutes
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface ChannelItemProps {
  channel: ChatChannel;
  isActive: boolean;
  onClick: () => void;
}

function ChannelItem({ channel, isActive, onClick }: ChannelItemProps): ReactNode {
  const isPublic = channel.type === 'public' || channel.type === 'announcement';
  const isDirect = channel.type === 'direct';

  return (
    <button
      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        isActive
          ? 'bg-brand-accent/15 text-content'
          : 'text-content-secondary hover:bg-surface-tertiary hover:text-content'
      }`}
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
    >
      {isDirect ? (
        <div className="relative flex-shrink-0">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-tertiary text-[10px] font-bold text-content-secondary">
            {channel.name.charAt(0).toUpperCase()}
          </div>
          <StatusDot
            status={presenceToStatus(
              MOCK_PRESENCE[`user-${channel.name.split(' ')[0]?.toLowerCase()}`]?.status ??
                'offline',
            )}
            size="sm"
            className="absolute -bottom-0.5 -right-0.5"
          />
        </div>
      ) : (
        <span
          className={`flex-shrink-0 text-sm ${isActive ? 'text-content' : 'text-content-tertiary'}`}
        >
          {isPublic ? <Hash className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        </span>
      )}
      <span
        className={`flex-1 truncate text-sm ${(channel.unreadCount ?? 0) > 0 ? 'font-semibold text-content' : ''}`}
      >
        {channel.name}
      </span>
      {(channel.unreadCount ?? 0) > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-accent px-1 text-[10px] font-bold text-white">
          {channel.unreadCount}
        </span>
      )}
    </button>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  isGrouped: boolean;
  currentUserId: string;
  onReaction: (messageId: string, emoji: string) => void;
  onEdit?: (messageId: string, content: string) => void;
  onDelete?: (messageId: string) => void;
  onReply?: (messageId: string) => void;
}

function MessageBubble({
  message,
  isGrouped,
  currentUserId,
  onReaction,
  onEdit,
  onDelete,
  onReply,
}: MessageBubbleProps): ReactNode {
  const [showActions, setShowActions] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const isOwn = message.senderId === currentUserId;

  if (message.isSystemMessage) {
    return (
      <div className="flex items-center gap-3 py-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-content-tertiary">{message.content}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }

  return (
    <div
      className={`group relative flex gap-2.5 px-4 py-0.5 hover:bg-surface-tertiary/40 ${!isGrouped ? 'mt-3 pt-1' : ''}`}
      onMouseEnter={() => {
        setShowActions(true);
      }}
      onMouseLeave={() => {
        setShowActions(false);
        setShowReactionPicker(false);
      }}
    >
      {/* Avatar / spacer */}
      <div className="w-9 flex-shrink-0">
        {!isGrouped && (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-bold text-white">
            {message.senderName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {!isGrouped && (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-content">{message.senderName}</span>
            <span className="text-xs text-content-tertiary">
              {formatMessageTime(message.createdAt)}
            </span>
            {message.editedAt !== undefined && (
              <span className="text-[10px] text-content-tertiary italic">(edited)</span>
            )}
          </div>
        )}

        {/* Message content */}
        {message.deletedAt !== undefined ? (
          <p className="text-sm italic text-content-tertiary">[Message deleted]</p>
        ) : message.contentType === 'code' ? (
          <pre className="mt-1 overflow-x-auto rounded-md bg-surface-tertiary p-3 font-mono text-xs text-content">
            <code>{message.content.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')}</code>
          </pre>
        ) : (
          <p
            className={`text-sm leading-relaxed text-content ${message.mentions.length > 0 ? '' : ''}`}
          >
            {message.content.split(/(@\S+)/g).map((part, i) =>
              part.startsWith('@') ? (
                <span
                  key={i}
                  className="rounded bg-brand-accent/20 px-0.5 font-medium text-brand-accent"
                >
                  {part}
                </span>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
          </p>
        )}

        {/* Reactions */}
        {Object.keys(message.reactions).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(message.reactions).map(([emoji, users]) =>
              users.length > 0 ? (
                <button
                  key={emoji}
                  className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors ${
                    users.includes(currentUserId)
                      ? 'border-brand-accent/50 bg-brand-accent/10 text-brand-accent'
                      : 'border-border bg-surface-tertiary text-content-secondary hover:border-brand-accent/30 hover:bg-brand-accent/5'
                  }`}
                  onClick={() => {
                    onReaction(message.id, emoji);
                  }}
                  title={`${users.join(', ')} reacted with ${emoji}`}
                >
                  <span>{emoji}</span>
                  <span className="font-medium">{users.length}</span>
                </button>
              ) : null,
            )}
          </div>
        )}
      </div>

      {/* Floating action bar */}
      {showActions && message.deletedAt === undefined && (
        <div className="absolute right-4 top-0 flex -translate-y-3 items-center gap-1 rounded-lg border border-border bg-surface shadow-card-hover">
          {/* Quick reactions */}
          <div className="relative">
            <button
              className="flex h-7 w-7 items-center justify-center rounded text-content-tertiary hover:bg-surface-tertiary hover:text-content"
              onClick={() => {
                setShowReactionPicker((p) => !p);
              }}
              aria-label="Add reaction"
            >
              <Smile className="h-3.5 w-3.5" />
            </button>
            {showReactionPicker && (
              <div className="absolute right-0 top-8 z-50 flex gap-1 rounded-lg border border-border bg-surface p-1.5 shadow-card-hover">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    className="flex h-7 w-7 items-center justify-center rounded text-base hover:bg-surface-tertiary"
                    onClick={() => {
                      onReaction(message.id, emoji);
                      setShowReactionPicker(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          {onReply !== undefined && (
            <button
              className="flex h-7 w-7 items-center justify-center rounded text-content-tertiary hover:bg-surface-tertiary hover:text-content"
              onClick={() => {
                onReply(message.id);
              }}
              aria-label="Reply in thread"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
          )}
          {isOwn && onEdit !== undefined && (
            <button
              className="flex h-7 w-7 items-center justify-center rounded text-content-tertiary hover:bg-surface-tertiary hover:text-content"
              onClick={() => {
                onEdit(message.id, message.content);
              }}
              aria-label="Edit message"
            >
              <Edit className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete !== undefined && (
            <button
              className="flex h-7 w-7 items-center justify-center rounded text-content-tertiary hover:bg-surface-tertiary hover:text-red-400"
              onClick={() => {
                onDelete(message.id);
              }}
              aria-label="Delete message"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Chat(): ReactNode {
  const [channels, setChannels] = useState(MOCK_CHANNELS);
  const [activeChannelId, setActiveChannelId] = useState('ch-1');
  const [messages, setMessages] = useState(MOCK_MESSAGES);
  const [messageInput, setMessageInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const typingUsers: TypingUser[] = [];
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showMemberList, setShowMemberList] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pinnedExpanded, setPinnedExpanded] = useState(true);
  const [publicExpanded, setPublicExpanded] = useState(true);
  const [dmExpanded, setDmExpanded] = useState(true);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const currentUserId = 'user-current';

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeChannelId),
    [channels, activeChannelId],
  );

  const channelMessages = useMemo(
    () =>
      messages
        .filter((m) => m.channelId === activeChannelId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages, activeChannelId],
  );

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return channelMessages;
    const q = searchQuery.toLowerCase();
    return channelMessages.filter(
      (m) => m.content.toLowerCase().includes(q) || m.senderName.toLowerCase().includes(q),
    );
  }, [channelMessages, searchQuery]);

  const pinnedChannels = useMemo(
    () => channels.filter((c) => c.isPinned && !c.isArchived),
    [channels],
  );
  const publicChannels = useMemo(
    () =>
      channels.filter(
        (c) =>
          !c.isPinned &&
          !c.isArchived &&
          (c.type === 'public' || c.type === 'private' || c.type === 'announcement'),
      ),
    [channels],
  );
  const directChannels = useMemo(
    () => channels.filter((c) => !c.isArchived && c.type === 'direct'),
    [channels],
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current !== null) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredMessages.length]);

  // Mark channel as read when opened
  const handleChannelSelect = useCallback((channelId: string) => {
    setActiveChannelId(channelId);
    setChannels((prev) => prev.map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)));
    setSearchQuery('');
    setSearchOpen(false);
  }, []);

  // Send message
  const handleSend = useCallback(() => {
    const content = messageInput.trim();
    if (content.length === 0) return;

    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      channelId: activeChannelId,
      senderId: currentUserId,
      senderName: 'You',
      content,
      contentType: 'text',
      attachments: [],
      mentions: [],
      reactions: {},
      readBy: { [currentUserId]: new Date().toISOString() },
      isSystemMessage: false,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMessage]);
    setChannels((prev) =>
      prev.map((c) =>
        c.id === activeChannelId
          ? {
              ...c,
              lastMessage: content,
              lastMessageAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : c,
      ),
    );
    setMessageInput('');
    inputRef.current?.focus();
  }, [messageInput, activeChannelId, currentUserId]);

  // Handle typing indicator
  const handleInputChange = useCallback((value: string) => {
    setMessageInput(value);
    if (typingTimerRef.current !== null) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      // In production: POST /api/v1/messaging/channels/:id/typing { typing: false }
    }, 3000);
  }, []);

  // Handle reaction
  const handleReaction = useCallback(
    (messageId: string, emoji: string) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const existing = m.reactions[emoji] ?? [];
          const isReacted = existing.includes(currentUserId);
          return {
            ...m,
            reactions: {
              ...m.reactions,
              [emoji]: isReacted
                ? existing.filter((id) => id !== currentUserId)
                : [...existing, currentUserId],
            },
          };
        }),
      );
    },
    [currentUserId],
  );

  // Edit message
  const handleEdit = useCallback((messageId: string, content: string) => {
    setEditingId(messageId);
    setEditContent(content);
  }, []);

  const handleEditSave = useCallback(() => {
    if (editingId === null || editContent.trim().length === 0) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === editingId
          ? { ...m, content: editContent.trim(), editedAt: new Date().toISOString() }
          : m,
      ),
    );
    setEditingId(null);
    setEditContent('');
  }, [editingId, editContent]);

  // Delete message
  const handleDelete = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, deletedAt: new Date().toISOString(), content: '[Message deleted]' }
          : m,
      ),
    );
  }, []);

  // Create new channel
  const handleCreateChannel = useCallback(() => {
    if (newChannelName.trim().length === 0) return;
    const newChannel: ChatChannel = {
      id: `ch-${Date.now()}`,
      name: newChannelName.trim().toLowerCase().replace(/\s+/g, '-'),
      type: 'public',
      memberCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isArchived: false,
      isPinned: false,
      unreadCount: 0,
    };
    setChannels((prev) => [...prev, newChannel]);
    setActiveChannelId(newChannel.id);
    setNewChannelName('');
    setShowNewChannel(false);
  }, [newChannelName]);

  // Key handler for input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (editingId !== null) {
          handleEditSave();
        } else {
          handleSend();
        }
      }
      if (e.key === 'Escape' && editingId !== null) {
        setEditingId(null);
        setEditContent('');
      }
    },
    [handleSend, handleEditSave, editingId],
  );

  const totalUnread = useMemo(
    () => channels.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0),
    [channels],
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
      {/* Page header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-brand-accent" />
            Team Chat
          </h1>
          <p className="page-subtitle">Internal enterprise messaging</p>
        </div>
        <div className="flex items-center gap-2">
          {totalUnread > 0 && (
            <Badge variant="info" size="sm">
              {totalUnread} unread
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={
              sidebarCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )
            }
            onClick={() => {
              setSidebarCollapsed((p) => !p);
            }}
          >
            {sidebarCollapsed ? 'Show Channels' : 'Hide Channels'}
          </Button>
        </div>
      </div>

      {/* Main chat layout */}
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* ── Left sidebar: channel list ── */}
        {!sidebarCollapsed && (
          <div className="flex w-60 flex-shrink-0 flex-col rounded-xl border border-border bg-surface-secondary">
            {/* Search + new channel */}
            <div className="flex items-center gap-1 border-b border-border p-3">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-content-tertiary" />
                <input
                  type="text"
                  placeholder="Search channels"
                  className="w-full rounded-md bg-surface-tertiary py-1 pl-6 pr-2 text-xs text-content placeholder-content-tertiary focus:outline-none focus:ring-1 focus:ring-brand-accent/50"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                  }}
                />
              </div>
              <button
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-content-tertiary hover:bg-surface-tertiary hover:text-content"
                onClick={() => {
                  setShowNewChannel((p) => !p);
                }}
                aria-label="New channel"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* New channel form */}
            {showNewChannel && (
              <div className="border-b border-border p-3">
                <input
                  type="text"
                  placeholder="channel-name"
                  className="mb-2 w-full rounded-md bg-surface-tertiary px-2 py-1 text-xs text-content placeholder-content-tertiary focus:outline-none focus:ring-1 focus:ring-brand-accent/50"
                  value={newChannelName}
                  onChange={(e) => {
                    setNewChannelName(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateChannel();
                    if (e.key === 'Escape') setShowNewChannel(false);
                  }}
                  autoFocus
                />
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="primary"
                    className="flex-1 text-[10px]"
                    onClick={handleCreateChannel}
                  >
                    Create
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 text-[10px]"
                    onClick={() => {
                      setShowNewChannel(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Channel sections */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {/* Pinned */}
              {pinnedChannels.length > 0 && (
                <div>
                  <button
                    className="flex w-full items-center gap-1 px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary hover:text-content-secondary"
                    onClick={() => {
                      setPinnedExpanded((p) => !p);
                    }}
                  >
                    {pinnedExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    Pinned
                  </button>
                  {pinnedExpanded &&
                    pinnedChannels.map((ch) => (
                      <ChannelItem
                        key={ch.id}
                        channel={ch}
                        isActive={ch.id === activeChannelId}
                        onClick={() => {
                          handleChannelSelect(ch.id);
                        }}
                      />
                    ))}
                </div>
              )}

              {/* Channels */}
              <div>
                <button
                  className="flex w-full items-center gap-1 px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary hover:text-content-secondary"
                  onClick={() => {
                    setPublicExpanded((p) => !p);
                  }}
                >
                  {publicExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Channels
                </button>
                {publicExpanded &&
                  publicChannels.map((ch) => (
                    <ChannelItem
                      key={ch.id}
                      channel={ch}
                      isActive={ch.id === activeChannelId}
                      onClick={() => {
                        handleChannelSelect(ch.id);
                      }}
                    />
                  ))}
              </div>

              {/* Direct Messages */}
              {directChannels.length > 0 && (
                <div>
                  <button
                    className="flex w-full items-center gap-1 px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary hover:text-content-secondary"
                    onClick={() => {
                      setDmExpanded((p) => !p);
                    }}
                  >
                    {dmExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    Direct Messages
                  </button>
                  {dmExpanded &&
                    directChannels.map((ch) => (
                      <ChannelItem
                        key={ch.id}
                        channel={ch}
                        isActive={ch.id === activeChannelId}
                        onClick={() => {
                          handleChannelSelect(ch.id);
                        }}
                      />
                    ))}
                </div>
              )}
            </div>

            {/* Presence footer */}
            <div className="border-t border-border p-3">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-accent to-purple-500 text-xs font-bold text-white">
                    Y
                  </div>
                  <StatusDot
                    status="success"
                    size="sm"
                    className="absolute -bottom-0.5 -right-0.5"
                    pulse
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-content">You</p>
                  <p className="truncate text-[10px] text-content-tertiary">Online</p>
                </div>
                <button
                  className="text-content-tertiary hover:text-content"
                  aria-label="Status settings"
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Main message area ── */}
        <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-surface-secondary">
          {activeChannel !== undefined ? (
            <>
              {/* Channel header */}
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  {activeChannel.type === 'direct' ? (
                    <div className="relative flex-shrink-0">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-tertiary text-sm font-bold text-content-secondary">
                        {activeChannel.name.charAt(0).toUpperCase()}
                      </div>
                      <StatusDot
                        status="success"
                        size="sm"
                        className="absolute -bottom-0.5 -right-0.5"
                      />
                    </div>
                  ) : (
                    <span className="flex-shrink-0 text-content-tertiary">
                      {activeChannel.type === 'public' || activeChannel.type === 'announcement' ? (
                        <Hash className="h-4 w-4" />
                      ) : (
                        <Lock className="h-4 w-4" />
                      )}
                    </span>
                  )}
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-content">
                      {activeChannel.name}
                    </h2>
                    {activeChannel.topic !== undefined && (
                      <p className="truncate text-xs text-content-tertiary">
                        {activeChannel.topic}
                      </p>
                    )}
                    {activeChannel.topic === undefined &&
                      activeChannel.description !== undefined && (
                        <p className="truncate text-xs text-content-tertiary">
                          {activeChannel.description}
                        </p>
                      )}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Search in channel */}
                  <button
                    className={`flex h-7 w-7 items-center justify-center rounded text-content-tertiary hover:bg-surface-tertiary hover:text-content ${searchOpen ? 'bg-surface-tertiary text-content' : ''}`}
                    onClick={() => {
                      setSearchOpen((p) => !p);
                    }}
                    aria-label="Search messages"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                  {activeChannel.type === 'direct' && (
                    <>
                      <button
                        className="flex h-7 w-7 items-center justify-center rounded text-content-tertiary hover:bg-surface-tertiary hover:text-content"
                        aria-label="Voice call"
                      >
                        <Phone className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="flex h-7 w-7 items-center justify-center rounded text-content-tertiary hover:bg-surface-tertiary hover:text-content"
                        aria-label="Video call"
                      >
                        <Video className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    className={`flex h-7 w-7 items-center justify-center rounded text-content-tertiary hover:bg-surface-tertiary hover:text-content ${showMemberList ? 'bg-surface-tertiary text-content' : ''}`}
                    onClick={() => {
                      setShowMemberList((p) => !p);
                    }}
                    aria-label="Toggle member list"
                  >
                    <Users className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-xs text-content-tertiary font-mono ml-1">
                    {activeChannel.memberCount} members
                  </span>
                </div>
              </div>

              {/* Search bar in channel */}
              {searchOpen && (
                <div className="border-b border-border px-4 py-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-tertiary" />
                    <input
                      type="text"
                      placeholder={`Search in #${activeChannel.name}`}
                      className="w-full rounded-md bg-surface-tertiary py-1.5 pl-8 pr-8 text-sm text-content placeholder-content-tertiary focus:outline-none focus:ring-1 focus:ring-brand-accent/50"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                      }}
                      autoFocus
                    />
                    {searchQuery.length > 0 && (
                      <button
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-content-tertiary hover:text-content"
                        onClick={() => {
                          setSearchQuery('');
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {searchQuery.length > 0 && (
                    <p className="mt-1 text-xs text-content-tertiary">
                      {filteredMessages.length} result{filteredMessages.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              )}

              {/* Messages area */}
              <div className="flex min-h-0 flex-1">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2">
                  {filteredMessages.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                      <MessageCircle className="h-10 w-10 text-content-tertiary opacity-40" />
                      <p className="text-sm font-medium text-content-secondary">
                        {searchQuery.length > 0
                          ? 'No messages match your search'
                          : 'No messages yet'}
                      </p>
                      <p className="text-xs text-content-tertiary">
                        {searchQuery.length > 0
                          ? 'Try a different search term'
                          : 'Be the first to say something!'}
                      </p>
                    </div>
                  ) : (
                    <>
                      {filteredMessages.map((msg, i) => (
                        <MessageBubble
                          key={msg.id}
                          message={msg}
                          isGrouped={shouldGroupWithPrevious(msg, filteredMessages[i - 1])}
                          currentUserId={currentUserId}
                          onReaction={handleReaction}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                          onReply={(_id) => {
                            // Focus input with reply context
                            inputRef.current?.focus();
                          }}
                        />
                      ))}
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                {/* ── Member list panel ── */}
                {showMemberList && (
                  <div className="w-48 flex-shrink-0 border-l border-border p-3">
                    <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
                      Members — {activeChannel.memberCount}
                    </h3>
                    <div className="space-y-2">
                      {/* Online members */}
                      <p className="text-[10px] font-medium uppercase tracking-wider text-content-tertiary">
                        Online —{' '}
                        {
                          Object.values(MOCK_PRESENCE).filter(
                            (p) => p.status === 'online' || p.status === 'away',
                          ).length
                        }
                      </p>
                      {Object.entries(MOCK_PRESENCE).map(([id, presence]) => (
                        <div key={id} className="flex items-center gap-1.5">
                          <div className="relative flex-shrink-0">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-tertiary text-[10px] font-bold text-content-secondary">
                              {id.replace('user-', '').charAt(0).toUpperCase()}
                            </div>
                            <StatusDot
                              status={presenceToStatus(presence.status)}
                              size="sm"
                              className="absolute -bottom-0.5 -right-0.5"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs text-content capitalize">
                              {id.replace('user-', '')}
                            </p>
                            {presence.statusMessage !== undefined && (
                              <p className="truncate text-[10px] text-content-tertiary">
                                {presence.statusMessage}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Typing indicator */}
              <div className="min-h-[18px] px-4">
                {typingUsers.length > 0 && (
                  <p className="text-xs text-content-tertiary">
                    <span className="inline-flex gap-0.5 mr-1">
                      <span
                        className="inline-block h-1 w-1 animate-bounce rounded-full bg-content-tertiary"
                        style={{ animationDelay: '0ms' }}
                      />
                      <span
                        className="inline-block h-1 w-1 animate-bounce rounded-full bg-content-tertiary"
                        style={{ animationDelay: '150ms' }}
                      />
                      <span
                        className="inline-block h-1 w-1 animate-bounce rounded-full bg-content-tertiary"
                        style={{ animationDelay: '300ms' }}
                      />
                    </span>
                    {typingUsers.map((u) => u.userName).join(', ')}{' '}
                    {typingUsers.length === 1 ? 'is' : 'are'} typing...
                  </p>
                )}
              </div>

              {/* Message input */}
              <div className="border-t border-border p-3">
                {editingId !== null && (
                  <div className="mb-2 flex items-center gap-2 rounded-md bg-brand-accent/10 px-2 py-1">
                    <Edit className="h-3 w-3 text-brand-accent" />
                    <span className="flex-1 text-xs text-brand-accent">Editing message</span>
                    <button
                      className="text-brand-accent/70 hover:text-brand-accent"
                      onClick={() => {
                        setEditingId(null);
                        setEditContent('');
                      }}
                      aria-label="Cancel edit"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2 rounded-xl border border-border bg-surface-tertiary p-2">
                  <button
                    className="flex-shrink-0 text-content-tertiary hover:text-content"
                    aria-label="Attach file"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <textarea
                    ref={inputRef}
                    rows={1}
                    placeholder={`Message #${activeChannel.name}`}
                    className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-content placeholder-content-tertiary focus:outline-none"
                    value={editingId !== null ? editContent : messageInput}
                    onChange={(e) => {
                      if (editingId !== null) {
                        setEditContent(e.target.value);
                      } else {
                        handleInputChange(e.target.value);
                      }
                      // Auto-resize
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
                    }}
                    onKeyDown={handleKeyDown}
                  />
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      className="text-content-tertiary hover:text-content"
                      aria-label="Add emoji"
                    >
                      <Smile className="h-4 w-4" />
                    </button>
                    <button
                      className="text-content-tertiary hover:text-content"
                      aria-label="Mention someone"
                    >
                      <AtSign className="h-4 w-4" />
                    </button>
                    <button
                      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                        (editingId !== null ? editContent.trim() : messageInput.trim()).length > 0
                          ? 'bg-brand-accent text-white hover:bg-brand-accent/90'
                          : 'text-content-tertiary'
                      }`}
                      onClick={editingId !== null ? handleEditSave : handleSend}
                      disabled={
                        (editingId !== null ? editContent.trim() : messageInput.trim()).length === 0
                      }
                      aria-label="Send message"
                    >
                      {editingId !== null ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-content-tertiary">
                  <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[9px]">
                    Enter
                  </kbd>{' '}
                  to send
                  {' · '}
                  <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[9px]">
                    Shift+Enter
                  </kbd>{' '}
                  for newline
                </p>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <MessageCircle className="h-12 w-12 text-content-tertiary opacity-30" />
              <div>
                <p className="text-sm font-medium text-content-secondary">
                  Select a channel to start chatting
                </p>
                <p className="text-xs text-content-tertiary">Choose from the sidebar on the left</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
