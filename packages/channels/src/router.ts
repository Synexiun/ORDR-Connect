/**
 * Channel router — intelligent channel selection and dispatch for ORDR-Connect
 *
 * COMPLIANCE:
 * - TCPA: Consent is verified BEFORE any outbound message
 * - Compliance gate: Messages blocked by regulation are filtered out
 * - Rate limiting: Per-channel, per-recipient limits enforced
 * - Customer preferences: Respected in channel ordering
 * - Circuit breaker: Unavailable channels are skipped
 * - Cost optimization: Cheapest viable channel is preferred
 * - NEVER logs message content (PHI/PII) — only routing metadata
 *
 * Selection algorithm:
 *   1. Filter by consent (remove opted-out channels)
 *   2. Filter by compliance gate (remove channels blocked by regulation)
 *   3. Filter by rate limit (remove channels at limit)
 *   4. Apply customer preference ordering
 *   5. Apply channel availability (circuit breaker status)
 *   6. Apply cost optimization (SMS < email < WhatsApp < voice)
 *   7. Return top channel, or err if none available
 */

import {
  type Result,
  ok,
  err,
  ValidationError,
  InternalError,
  ComplianceViolationError,
} from '@ordr/core';

import type { Channel, SendResult, ConsentStore } from './types.js';
import { CHANNELS, CONSENT_STATUSES } from './types.js';
import type { SmsProvider } from './sms.js';
import type { EmailProvider } from './email.js';
import type { VoiceProvider } from './voice.js';
import type { WhatsAppProvider } from './whatsapp.js';
import type { ConsentManager } from './consent.js';
import type { ChannelRateLimiter } from './rate-limiter.js';
import type { CircuitBreaker } from './circuit-breaker.js';

// ─── Channel Preference ─────────────────────────────────────────

export interface ChannelPreference {
  readonly channel: Channel;
  readonly priority: number; // 1-5 (1 = most preferred)
  readonly contactValue: string; // phone number or email address
}

// ─── Outbound Message ───────────────────────────────────────────

export interface OutboundMessage {
  readonly customerId: string;
  readonly tenantId: string;
  /** Encrypted storage reference — NEVER raw content */
  readonly contentRef: string;
  readonly contentType: 'text' | 'template' | 'rich';
  readonly metadata: Readonly<Record<string, string>>;
}

// ─── Compliance Gate Interface ──────────────────────────────────

/**
 * Compliance gate checks whether a message on a given channel
 * is permitted by regulatory requirements.
 */
export interface ComplianceGate {
  checkChannel(
    channel: Channel,
    customerId: string,
    tenantId: string,
  ): Promise<Result<true, ComplianceViolationError>>;
}

// ─── Selected Channel ───────────────────────────────────────────

export interface SelectedChannel {
  readonly channel: Channel;
  readonly contactValue: string;
  readonly priority: number;
}

// ─── Cost Ordering ──────────────────────────────────────────────

/**
 * Relative cost ordering for channels.
 * Lower number = cheaper. Used as tiebreaker when preferences are equal.
 */
const CHANNEL_COST_ORDER: Readonly<Record<Channel, number>> = {
  [CHANNELS.EMAIL]: 1,
  [CHANNELS.SMS]: 2,
  [CHANNELS.WHATSAPP]: 3,
  [CHANNELS.VOICE]: 4,
} as const;

// ─── Channel Router ─────────────────────────────────────────────

export class ChannelRouter {
  private readonly sms: SmsProvider;
  private readonly email: EmailProvider;
  private readonly voice: VoiceProvider;
  private readonly whatsApp: WhatsAppProvider;
  private readonly consent: ConsentManager;
  private readonly consentStore: ConsentStore;
  private readonly compliance: ComplianceGate;
  private readonly rateLimiter: ChannelRateLimiter;
  private readonly circuitBreakers: Readonly<Record<Channel, CircuitBreaker>>;

  constructor(deps: {
    readonly sms: SmsProvider;
    readonly email: EmailProvider;
    readonly voice: VoiceProvider;
    readonly whatsApp: WhatsAppProvider;
    readonly consent: ConsentManager;
    readonly consentStore: ConsentStore;
    readonly compliance: ComplianceGate;
    readonly rateLimiter: ChannelRateLimiter;
    readonly circuitBreakers: Readonly<Record<Channel, CircuitBreaker>>;
  }) {
    this.sms = deps.sms;
    this.email = deps.email;
    this.voice = deps.voice;
    this.whatsApp = deps.whatsApp;
    this.consent = deps.consent;
    this.consentStore = deps.consentStore;
    this.compliance = deps.compliance;
    this.rateLimiter = deps.rateLimiter;
    this.circuitBreakers = deps.circuitBreakers;
  }

  /**
   * Select the best available channel for outbound messaging.
   *
   * Applies filters in order:
   *   1. Consent → 2. Compliance → 3. Rate limit → 4. Preference → 5. Circuit breaker → 6. Cost
   *
   * SECURITY: Only channel metadata is processed — message content is never accessed.
   */
  async selectChannel(
    customerId: string,
    tenantId: string,
    preferences: readonly ChannelPreference[],
    message: OutboundMessage,
  ): Promise<Result<SelectedChannel, ValidationError | ComplianceViolationError | InternalError>> {
    if (preferences.length === 0) {
      return err(
        new ValidationError('No channel preferences configured', {
          preferences: ['At least one channel preference is required'],
        }),
      );
    }

    // Step 1: Filter by consent
    const consentFiltered: ChannelPreference[] = [];
    for (const pref of preferences) {
      const consentStatus = await this.consent.checkConsent(
        customerId,
        pref.channel,
        this.consentStore,
      );

      if (consentStatus === CONSENT_STATUSES.OPTED_IN) {
        consentFiltered.push(pref);
      }
    }

    if (consentFiltered.length === 0) {
      return err(
        new ComplianceViolationError(
          'No channels available — customer has not opted in on any channel',
          'TCPA',
        ),
      );
    }

    // Step 2: Filter by compliance gate
    const complianceFiltered: ChannelPreference[] = [];
    for (const pref of consentFiltered) {
      const complianceResult = await this.compliance.checkChannel(
        pref.channel,
        customerId,
        tenantId,
      );

      if (complianceResult.success) {
        complianceFiltered.push(pref);
      }
    }

    if (complianceFiltered.length === 0) {
      return err(
        new ComplianceViolationError(
          'No channels available — all channels blocked by compliance rules',
          'REGULATORY',
        ),
      );
    }

    // Step 3: Filter by rate limit
    const rateLimitFiltered: ChannelPreference[] = [];
    for (const pref of complianceFiltered) {
      const withinLimit = this.rateLimiter.checkLimit(pref.channel, pref.contactValue);
      if (withinLimit) {
        rateLimitFiltered.push(pref);
      }
    }

    if (rateLimitFiltered.length === 0) {
      return err(
        new InternalError('No channels available — all channels at rate limit'),
      );
    }

    // Step 4: Sort by customer preference (lower priority number = preferred)
    const sorted = [...rateLimitFiltered].sort((a, b) => {
      // Primary sort: customer preference (ascending)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // Secondary sort: cost optimization (ascending)
      return CHANNEL_COST_ORDER[a.channel] - CHANNEL_COST_ORDER[b.channel];
    });

    // Step 5: Filter by circuit breaker availability
    for (const pref of sorted) {
      const breaker = this.circuitBreakers[pref.channel];
      if (breaker.isAvailable()) {
        return ok({
          channel: pref.channel,
          contactValue: pref.contactValue,
          priority: pref.priority,
        });
      }
    }

    return err(
      new InternalError('No channels available — all channels are circuit-broken'),
    );
  }

  /**
   * Dispatch a message to the correct provider based on channel.
   *
   * SECURITY: Content is passed through by reference — this method
   * accesses the content ONLY to forward to the provider. NEVER logged.
   */
  async send(
    channel: Channel,
    contactValue: string,
    content: string,
    metadata?: Readonly<Record<string, string>>,
  ): Promise<Result<SendResult, ValidationError | InternalError>> {
    switch (channel) {
      case CHANNELS.SMS:
        return this.sms.send(contactValue, content);

      case CHANNELS.EMAIL: {
        const subject = metadata?.['subject'] ?? 'ORDR Notification';
        return this.email.send(contactValue, subject, content);
      }

      case CHANNELS.VOICE:
        return this.voice.initiateCall(contactValue, content).then((result) => {
          if (!result.success) return result;
          // Map CallResult to SendResult for consistent interface
          return ok({
            success: true,
            messageId: result.data.callSid,
            providerMessageId: result.data.callSid,
            status: this.voice.mapCallStatusToMessageStatus(result.data.status),
            error: undefined,
          } as SendResult);
        });

      case CHANNELS.WHATSAPP: {
        const templateSid = metadata?.['templateSid'];
        if (templateSid) {
          const variables: Record<string, string> = {};
          for (const [key, value] of Object.entries(metadata ?? {})) {
            if (key.startsWith('var_')) {
              variables[key.substring(4)] = value;
            }
          }
          return this.whatsApp.sendTemplate(contactValue, templateSid, variables);
        }
        return this.whatsApp.sendMessage(contactValue, content);
      }

      default: {
        // Exhaustive check — TypeScript ensures this is unreachable
        const _exhaustive: never = channel;
        return err(
          new ValidationError(`Unsupported channel: ${_exhaustive as string}`, {
            channel: ['Channel is not supported'],
          }),
        );
      }
    }
  }
}
