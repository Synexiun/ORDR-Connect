/**
 * TicketConversation — Message thread with reply form.
 *
 * Displays messages with different styling per author role:
 *   user   -> left-aligned, default surface
 *   admin  -> left-aligned, blue tint
 *   system -> centered, muted italic
 *
 * COMPLIANCE:
 * - No PHI in ticket messages rendered to logs (Rule 6)
 * - Content validated before submission (Rule 4)
 */

import { type ReactNode, useState, useCallback } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { Send, User, Shield, Cpu } from '../icons';
import { cn } from '../../lib/cn';
import type { TicketMessage } from '../../lib/tickets-api';

interface TicketConversationProps {
  messages: TicketMessage[];
  onReply: (content: string) => void;
  disabled?: boolean;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const roleConfig: Record<
  TicketMessage['authorRole'],
  {
    icon: React.ComponentType<{ className?: string }>;
    badge: 'info' | 'warning' | 'neutral';
    label: string;
  }
> = {
  user: { icon: User, badge: 'info', label: 'User' },
  admin: { icon: Shield, badge: 'warning', label: 'Admin' },
  system: { icon: Cpu, badge: 'neutral', label: 'System' },
};

export function TicketConversation({
  messages,
  onReply,
  disabled = false,
}: TicketConversationProps): ReactNode {
  const [replyContent, setReplyContent] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = useCallback(() => {
    const trimmed = replyContent.trim();
    if (trimmed === '' || sending) return;

    setSending(true);
    try {
      onReply(trimmed);
      setReplyContent('');
    } finally {
      setSending(false);
    }
  }, [replyContent, sending, onReply]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="space-y-6">
      {/* Messages */}
      <div className="space-y-4">
        {messages.map((msg) => {
          const config = roleConfig[msg.authorRole];
          const Icon = config.icon;

          if (msg.authorRole === 'system') {
            return (
              <div key={msg.id} className="flex items-center gap-2 py-2">
                <div className="h-px flex-1 bg-border" />
                <div className="flex items-center gap-2 text-xs text-content-tertiary">
                  <Cpu className="h-3 w-3" />
                  <span className="italic">{msg.content}</span>
                </div>
                <div className="h-px flex-1 bg-border" />
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex gap-3">
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  msg.authorRole === 'admin' ? 'bg-amber-500/15' : 'bg-blue-500/15',
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4',
                    msg.authorRole === 'admin' ? 'text-amber-400' : 'text-blue-400',
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-content">{msg.author}</span>
                  <Badge variant={config.badge} size="sm">
                    {config.label}
                  </Badge>
                  <span className="text-xs text-content-tertiary">
                    {formatTimestamp(msg.createdAt)}
                  </span>
                </div>
                <div
                  className={cn(
                    'mt-2 rounded-lg border px-4 py-3',
                    msg.authorRole === 'admin'
                      ? 'border-amber-500/20 bg-amber-500/5'
                      : 'border-border bg-surface',
                  )}
                >
                  <p className="text-sm leading-relaxed text-content-secondary">{msg.content}</p>
                </div>
                {msg.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {msg.attachments.map((att, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center rounded bg-surface-tertiary px-2 py-1 text-xs text-content-secondary"
                      >
                        {att}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply form */}
      {!disabled && (
        <div className="border-t border-border pt-4">
          <Textarea
            placeholder="Type your reply... (Ctrl+Enter to send)"
            value={replyContent}
            onChange={(e) => {
              setReplyContent(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            rows={3}
            resize="vertical"
            maxLength={2000}
          />
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-content-tertiary">
              Messages are encrypted and logged in the audit trail.
            </p>
            <Button
              size="sm"
              onClick={() => {
                handleSend();
              }}
              disabled={replyContent.trim() === '' || sending}
              loading={sending}
              icon={<Send className="h-3.5 w-3.5" />}
            >
              Send Reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
