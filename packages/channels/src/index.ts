/**
 * @ordr/channels — multi-channel messaging for ORDR-Connect
 *
 * Compliance-first (SOC2/ISO27001/HIPAA/TCPA/CAN-SPAM) messaging
 * package supporting SMS, email, voice, and WhatsApp channels.
 *
 * SECURITY: No message content (PHI/PII) is ever logged.
 * All outbound messaging requires consent verification.
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  Channel,
  MessageDirection,
  MessageStatus,
  MessageEvent,
  DeliveryAttempt,
  Message,
  ConsentStatus,
  ConsentMethod,
  ConsentRecord,
  SmsChannelConfig,
  EmailChannelConfig,
  VoiceChannelConfig,
  WhatsAppChannelConfig,
  ChannelConfig,
  SendResult,
  SmsOptions,
  EmailOptions,
  InboundSmsMessage,
  EmailEvent,
  ConsentStore,
  RateLimitEntry,
  RateLimitConfig,
} from './types.js';

export {
  CHANNELS,
  MESSAGE_DIRECTIONS,
  MESSAGE_STATUSES,
  MESSAGE_EVENTS,
  CONSENT_STATUSES,
  CONSENT_METHODS,
} from './types.js';

// ─── State Machine ───────────────────────────────────────────────
export { MessageStateMachine, InvalidTransitionError } from './state-machine.js';

// ─── Consent ─────────────────────────────────────────────────────
export { ConsentManager, OPT_OUT_KEYWORDS, OPT_IN_KEYWORDS } from './consent.js';

// ─── SMS Provider ────────────────────────────────────────────────
export type {
  TwilioClient,
  TwilioCreateParams,
  TwilioMessageInstance,
  TwilioWebhookValidator,
} from './sms.js';

export { SmsProvider, validatePhoneNumber, createRealTwilioClient } from './sms.js';

// ─── Email Provider ──────────────────────────────────────────────
export type {
  SendGridClient,
  SendGridMessage,
  SendGridResponse,
  BrandedEmailOptions,
} from './email.js';

export {
  EmailProvider,
  validateEmail,
  injectBranding,
  DEFAULT_BRANDED_EMAIL_OPTIONS,
  createRealSendGridClient,
} from './email.js';

// ─── Voice Provider ──────────────────────────────────────────────
export type {
  CallResult,
  CallStatus,
  VoiceOptions,
  SayStep,
  GatherStep,
  DialStep,
  RecordStep,
  PauseStep,
  HangupStep,
  IvrStep,
  IvrFlow,
  CallStatusEvent,
  RecordingEvent,
  GatherEvent,
  TwilioVoiceClient,
  TwilioCallCreateParams,
  TwilioCallInstance,
} from './voice.js';

export { VoiceProvider, CALL_STATUSES } from './voice.js';

// ─── WhatsApp Provider ───────────────────────────────────────────
export type {
  WhatsAppInbound,
  WhatsAppStatusEvent,
  TwilioWhatsAppClient,
  TwilioWhatsAppCreateParams,
  TwilioWhatsAppMessageInstance,
} from './whatsapp.js';

export { WhatsAppProvider } from './whatsapp.js';

// ─── Circuit Breaker ─────────────────────────────────────────────
export type { CircuitState, CircuitBreakerConfig } from './circuit-breaker.js';

export {
  CircuitBreaker,
  CIRCUIT_STATES,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from './circuit-breaker.js';

// ─── Channel Router ──────────────────────────────────────────────
export type {
  ChannelPreference,
  OutboundMessage,
  ComplianceGate,
  SelectedChannel,
} from './router.js';

export { ChannelRouter } from './router.js';

// ─── Rate Limiter ────────────────────────────────────────────────
export { ChannelRateLimiter, DEFAULT_RATE_LIMITS } from './rate-limiter.js';
