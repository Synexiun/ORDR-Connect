/**
 * Integrations — CRM integration management.
 *
 * Shows available providers, their health status, and provides
 * the OAuth connection flow. Connected providers expose contact
 * and deal data browsing.
 *
 * SOC2 CC6.1 — OAuth tokens stored server-side only, never in client.
 * ISO 27001 A.12.4.1 — Connection events logged in audit chain.
 * HIPAA §164.312 — Contact data shown as metadata only; no PHI in URL params.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { Tabs } from '../components/ui/Tabs';
import { PageHeader } from '../components/layout/PageHeader';
import { AlertCircle, CheckCircle2, Link2, Activity, Users, Loader2 } from '../components/icons';
import {
  integrationsApi,
  type IntegrationHealth,
  type CRMContact,
  type CRMDeal,
} from '../lib/integrations-api';
import { useToast } from '../hooks/useToast';

// ── Health Badge ──────────────────────────────────────────────────

function HealthBadge({ status }: { status: IntegrationHealth['status'] }): ReactNode {
  const map = {
    healthy: { variant: 'success' as const, icon: <CheckCircle2 className="h-3 w-3" /> },
    degraded: { variant: 'warning' as const, icon: <AlertCircle className="h-3 w-3" /> },
    unhealthy: { variant: 'danger' as const, icon: <AlertCircle className="h-3 w-3" /> },
  };
  const { variant, icon } = map[status];
  return (
    <Badge variant={variant} size="sm">
      <span className="flex items-center gap-1">
        {icon}
        {status}
      </span>
    </Badge>
  );
}

// ── Provider Card ─────────────────────────────────────────────────

interface ProviderCardProps {
  provider: string;
  health: IntegrationHealth | null;
  healthLoading: boolean;
  onConnect: (provider: string) => void;
  onSelect: (provider: string) => void;
  selected: boolean;
}

function ProviderCard({
  provider,
  health,
  healthLoading,
  onConnect,
  onSelect,
  selected,
}: ProviderCardProps): ReactNode {
  const label = provider.charAt(0).toUpperCase() + provider.slice(1);
  const isConnected = health !== null;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`rounded-xl border border-border bg-surface-secondary cursor-pointer transition-all ${
        selected ? 'ring-2 ring-brand-accent' : 'hover:ring-1 hover:ring-border'
      }`}
      onClick={() => {
        onSelect(provider);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(provider);
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-content">{label}</p>
          <p className="text-2xs text-content-tertiary mt-0.5">OAuth 2.0</p>
        </div>
        {healthLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-content-tertiary" />
        ) : isConnected ? (
          <HealthBadge status={health.status} />
        ) : (
          <Badge variant="neutral" size="sm">
            Not connected
          </Badge>
        )}
      </div>

      {isConnected && (
        <p className="mt-2 text-2xs text-content-tertiary">
          Latency: {health.latencyMs}ms · Checked:{' '}
          {new Date(health.lastCheckedAt).toLocaleTimeString()}
        </p>
      )}

      <div className="mt-3">
        {isConnected ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(provider);
            }}
          >
            <Users className="h-3.5 w-3.5" />
            Browse
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={(e) => {
              e.stopPropagation();
              onConnect(provider);
            }}
          >
            <Link2 className="h-3.5 w-3.5" />
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Contacts Table ────────────────────────────────────────────────

function ContactsTable({ provider }: { provider: string }): ReactNode {
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (q: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await integrationsApi.listContacts(provider, {
          q: q || undefined,
          limit: 50,
        });
        setContacts(result.items);
        setTotal(result.total);
      } catch {
        setError('Failed to load contacts');
      } finally {
        setLoading(false);
      }
    },
    [provider],
  );

  useEffect(() => {
    void load('');
  }, [load]);

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search contacts…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          void load(e.target.value);
        }}
      />
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner size="md" label="Loading contacts" />
        </div>
      ) : error !== null ? (
        <div className="flex items-center gap-2 text-sm text-danger">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="No contacts"
          description="No contacts found for this query."
        />
      ) : (
        <>
          <p className="text-2xs text-content-tertiary">{total} total</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 px-3 text-left font-medium text-content-secondary">Name</th>
                  <th className="py-2 px-3 text-left font-medium text-content-secondary">Email</th>
                  <th className="py-2 px-3 text-left font-medium text-content-secondary">ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {contacts.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-secondary">
                    <td className="py-2 px-3 text-content">
                      {[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="py-2 px-3 text-content-secondary">{c.email ?? '—'}</td>
                    <td className="py-2 px-3 font-mono text-xs text-content-tertiary">{c.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Deals Table ───────────────────────────────────────────────────

function DealsTable({ provider }: { provider: string }): ReactNode {
  const [deals, setDeals] = useState<CRMDeal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    integrationsApi
      .listDeals(provider, { limit: 50 })
      .then((result) => {
        setDeals(result.items);
        setTotal(result.total);
      })
      .catch(() => {
        setError('Failed to load deals');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [provider]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" label="Loading deals" />
      </div>
    );
  }
  if (error !== null) {
    return (
      <div className="flex items-center gap-2 text-sm text-danger">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }
  if (deals.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="h-8 w-8" />}
        title="No deals"
        description="No deals found in this provider."
      />
    );
  }

  return (
    <>
      <p className="text-2xs text-content-tertiary mb-3">{total} total</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 px-3 text-left font-medium text-content-secondary">Name</th>
              <th className="py-2 px-3 text-left font-medium text-content-secondary">Stage</th>
              <th className="py-2 px-3 text-right font-medium text-content-secondary">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {deals.map((d) => (
              <tr key={d.id} className="hover:bg-surface-secondary">
                <td className="py-2 px-3 text-content">{d.name}</td>
                <td className="py-2 px-3 text-content-secondary">{d.stage ?? '—'}</td>
                <td className="py-2 px-3 text-right text-content-secondary">
                  {d.amount !== undefined
                    ? new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 0,
                      }).format(d.amount)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export function Integrations(): ReactNode {
  const { toast } = useToast();
  const [providers, setProviders] = useState<string[]>([]);
  const [health, setHealth] = useState<Record<string, IntegrationHealth | null>>({});
  const [healthLoading, setHealthLoading] = useState<Record<string, boolean>>({});
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('contacts');
  const [loadingProviders, setLoadingProviders] = useState(true);

  useEffect(() => {
    integrationsApi
      .listProviders()
      .then((list) => {
        setProviders(list);
        const loadingMap: Record<string, boolean> = {};
        for (const p of list) loadingMap[p] = true;
        setHealthLoading(loadingMap);

        void Promise.allSettled(
          list.map((p) =>
            integrationsApi
              .getHealth(p)
              .then((h) => {
                setHealth((prev) => ({ ...prev, [p]: h }));
              })
              .catch(() => {
                // Not connected — leave health as null
              })
              .finally(() => {
                setHealthLoading((prev) => ({ ...prev, [p]: false }));
              }),
          ),
        );
      })
      .catch(() => {
        toast('Failed to load integration providers', 'error');
      })
      .finally(() => {
        setLoadingProviders(false);
      });
  }, [toast]);

  const handleConnect = useCallback(
    async (provider: string) => {
      try {
        const redirectUri = `${window.location.origin}/integrations/callback`;
        const { authorizationUrl } = await integrationsApi.authorize(
          provider,
          redirectUri,
          crypto.randomUUID(),
        );
        window.location.href = authorizationUrl;
      } catch {
        toast(`Failed to start OAuth flow for ${provider}`, 'error');
      }
    },
    [toast],
  );

  if (loadingProviders) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" label="Loading integrations" />
      </div>
    );
  }

  const selectedHealth = selectedProvider !== null ? (health[selectedProvider] ?? null) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        subtitle="Connect your CRM providers to sync contacts and deals"
      />

      {providers.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-8 w-8" />}
          title="No providers available"
          description="Contact your administrator to enable integration providers."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => (
            <ProviderCard
              key={p}
              provider={p}
              health={health[p] ?? null}
              healthLoading={healthLoading[p] === true}
              onConnect={(prov) => {
                void handleConnect(prov);
              }}
              onSelect={setSelectedProvider}
              selected={selectedProvider === p}
            />
          ))}
        </div>
      )}

      {selectedProvider !== null && selectedHealth !== null && (
        <Card>
          <div className="p-4 border-b border-border">
            <h2 className="font-medium text-content capitalize">
              {selectedProvider} — Data Browser
            </h2>
          </div>
          <div className="p-4">
            <Tabs
              tabs={[
                { id: 'contacts', label: 'Contacts' },
                { id: 'deals', label: 'Deals' },
              ]}
              activeTab={activeTab}
              onChange={setActiveTab}
            />
            <div className="mt-4">
              {activeTab === 'contacts' && <ContactsTable provider={selectedProvider} />}
              {activeTab === 'deals' && <DealsTable provider={selectedProvider} />}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
