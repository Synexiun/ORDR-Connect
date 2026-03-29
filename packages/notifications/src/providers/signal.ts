/**
 * Signal Notification Provider
 *
 * Requires a self-hosted signal-cli-rest-api instance:
 * https://github.com/bbernhard/signal-cli-rest-api
 *
 * The instance must be pre-registered with a phone number.
 * Docker: docker run -p 8080:8080 bbernhard/signal-cli-rest-api
 *
 * Note: Signal does not have an official business API.
 * ISO 27001 A.13.2.3 — Secure messaging configuration required.
 */
import type {
  NotificationProvider,
  ChannelDestination,
  DeliveryResult,
  NotificationPriority,
  SignalConfig,
} from '../types.js';

export class SignalProvider implements NotificationProvider {
  readonly channel = 'signal' as const;
  private readonly config: SignalConfig | undefined;

  constructor(config?: SignalConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return (
      this.config !== undefined &&
      this.config.apiUrl.length > 0 &&
      this.config.senderNumber.length > 0
    );
  }

  async send(
    body: string,
    _subject: string | undefined,
    dest: ChannelDestination,
    _priority: NotificationPriority,
  ): Promise<DeliveryResult> {
    const sentAt = new Date();
    if (!this.isConfigured() || this.config === undefined) {
      return {
        channel: 'signal',
        status: 'failed',
        errorCode: 'NOT_CONFIGURED',
        errorMessage: 'Signal CLI REST API not configured',
        sentAt,
      };
    }
    if (dest.signalNumber === undefined) {
      return {
        channel: 'signal',
        status: 'failed',
        errorCode: 'NO_DESTINATION',
        errorMessage: 'signalNumber required',
        sentAt,
      };
    }
    try {
      const url = `${this.config.apiUrl}/v2/send`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: body,
          number: this.config.senderNumber,
          recipients: [dest.signalNumber],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        return {
          channel: 'signal',
          status: 'failed',
          errorCode: String(res.status),
          errorMessage: errText.slice(0, 200),
          sentAt,
        };
      }
      return { channel: 'signal', status: 'sent', sentAt };
    } catch (err) {
      return {
        channel: 'signal',
        status: 'failed',
        errorCode: 'NETWORK_ERROR',
        errorMessage: err instanceof Error ? err.message : 'Unknown',
        sentAt,
      };
    }
  }
}
