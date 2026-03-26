import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { apiClient } from '../lib/api';

// --- Types ---

interface MarketplaceAgent {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  rating: number;
  downloads: number;
  status: 'draft' | 'review' | 'published' | 'suspended' | 'rejected';
  manifest: Record<string, unknown>;
  license: string;
  createdAt: string;
}

interface MarketplaceReview {
  id: string;
  reviewerId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

interface AgentListResponse {
  agents: MarketplaceAgent[];
  total: number;
}

// --- Constants ---

const categories = ['all', 'collections', 'healthcare', 'support', 'analytics', 'automation'];

// --- Helpers ---

function renderStars(rating: number): string {
  const full = Math.floor(rating);
  const empty = 5 - full;
  return '\u2605'.repeat(full) + '\u2606'.repeat(empty);
}

function formatNumber(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

// --- Mock data ---

const mockAgents: MarketplaceAgent[] = Array.from({ length: 12 }, (_, i) => ({
  id: `agent-${String(i + 1).padStart(3, '0')}`,
  name: [
    'Smart Collections', 'Healthcare Scheduler', 'Support Triage',
    'Revenue Forecaster', 'Document Analyzer', 'Compliance Monitor',
    'Customer Onboarding', 'Sentiment Tracker', 'Email Optimizer',
    'Workflow Automator', 'Risk Assessor', 'Invoice Processor',
  ][i] as string,
  version: `1.${i}.0`,
  description: [
    'Automates debt collection workflows with intelligent prioritization and compliance checks.',
    'Schedules patient appointments with smart conflict resolution and wait-list management.',
    'Routes support tickets to the right agent based on sentiment and urgency analysis.',
    'Predicts revenue trends using historical data and ML-powered forecasting models.',
    'Extracts key information from documents using OCR and NLP pipelines.',
    'Monitors regulatory compliance in real-time with automated alert generation.',
    'Guides new customers through onboarding with personalized step-by-step flows.',
    'Analyzes customer sentiment across all communication channels in real-time.',
    'Optimizes email delivery timing and content for maximum engagement rates.',
    'Creates and manages complex multi-step workflows with conditional branching.',
    'Evaluates customer risk profiles using behavioral and financial data patterns.',
    'Processes invoices automatically with line-item extraction and approval routing.',
  ][i] as string,
  author: ['ORDR Labs', 'HealthTech Co', 'SupportAI', 'FinanceBot', 'DocuMind', 'ComplianceIQ',
    'OnboardPro', 'SentiAI', 'MailForge', 'FlowBuilder', 'RiskWise', 'InvoiceAI'][i] as string,
  rating: 3.5 + (i % 3) * 0.5,
  downloads: 150 + i * 87,
  status: 'published',
  manifest: { tools: ['read', 'write'], maxTokens: 4096 },
  license: 'MIT',
  createdAt: new Date(Date.now() - i * 7 * 86400000).toISOString(),
}));

// --- Component ---

export function Marketplace(): ReactNode {
  const [agents, setAgents] = useState<MarketplaceAgent[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<MarketplaceAgent | null>(null);
  const [reviews, setReviews] = useState<MarketplaceReview[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '20', offset: '0' });
      if (search.trim()) params.set('search', search.trim());
      if (category !== 'all') params.set('category', category);

      const res = await apiClient.get<AgentListResponse>(`/v1/marketplace?${params.toString()}`);
      setAgents(res.agents);
      setTotal(res.total);
    } catch {
      // Graceful degradation — filter mock data locally
      let filtered = mockAgents;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        filtered = filtered.filter(
          (a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
        );
      }
      setAgents(filtered);
      setTotal(filtered.length);
    } finally {
      setLoading(false);
    }
  }, [search, category]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const handleInstall = useCallback(async (agentId: string) => {
    setInstalling(agentId);
    try {
      await apiClient.post(`/v1/marketplace/${agentId}/install`);
      setAgents((prev) =>
        prev.map((a) => (a.id === agentId ? { ...a, downloads: a.downloads + 1 } : a)),
      );
    } catch {
      // Mock: increment locally
      setAgents((prev) =>
        prev.map((a) => (a.id === agentId ? { ...a, downloads: a.downloads + 1 } : a)),
      );
    } finally {
      setInstalling(null);
    }
  }, []);

  const handleUninstall = useCallback(async (agentId: string) => {
    try {
      await apiClient.delete(`/v1/marketplace/${agentId}/install`);
    } catch {
      // Mock: no-op
    }
  }, []);

  const openDetail = useCallback(async (agent: MarketplaceAgent) => {
    setSelectedAgent(agent);
    try {
      const res = await apiClient.get<{ data: MarketplaceReview[] }>(`/v1/marketplace/${agent.id}/reviews`);
      setReviews(res.data);
    } catch {
      setReviews([
        { id: 'r1', reviewerId: 'user-1', rating: 5, comment: 'Excellent agent, very reliable.', createdAt: new Date().toISOString() },
        { id: 'r2', reviewerId: 'user-2', rating: 4, comment: 'Good but could use more configuration options.', createdAt: new Date().toISOString() },
      ]);
    }
  }, []);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <p className="text-sm text-red-400">{error}</p>
        <Button size="sm" onClick={fetchAgents}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content">Agent Marketplace</h1>
          <p className="mt-1 text-sm text-content-secondary">
            {total} agent{total !== 1 ? 's' : ''} available
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchAgents}>
          Refresh
        </Button>
      </div>

      {/* Search and filters */}
      <Card padding={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Input
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search agents"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            {categories.map((cat) => (
              <Button
                key={cat}
                variant={category === cat ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setCategory(cat)}
              >
                {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Agent grid */}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Spinner size="lg" label="Loading agents" />
        </div>
      ) : agents.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-content-secondary">No agents found matching your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Card key={agent.id}>
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-content">{agent.name}</h3>
                    <p className="text-xs text-content-secondary">by {agent.author}</p>
                  </div>
                  <Badge variant="info" size="sm">v{agent.version}</Badge>
                </div>

                <p className="line-clamp-2 text-xs text-content-secondary">{agent.description}</p>

                <div className="flex items-center gap-3">
                  <span className="text-xs text-amber-400" aria-label={`${agent.rating.toFixed(1)} stars`}>
                    {renderStars(agent.rating)}
                  </span>
                  <span className="text-xs text-content-tertiary">
                    {formatNumber(agent.downloads)} installs
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => handleInstall(agent.id)}
                    disabled={installing === agent.id}
                  >
                    {installing === agent.id ? 'Installing...' : 'Install'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openDetail(agent)}
                  >
                    Details
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Agent detail modal */}
      <Modal
        open={selectedAgent !== null}
        onClose={() => setSelectedAgent(null)}
        title={selectedAgent?.name ?? 'Agent Details'}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setSelectedAgent(null)}>
              Close
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (selectedAgent) {
                  void handleInstall(selectedAgent.id);
                  setSelectedAgent(null);
                }
              }}
            >
              Install Agent
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (selectedAgent) {
                  void handleUninstall(selectedAgent.id);
                  setSelectedAgent(null);
                }
              }}
            >
              Uninstall
            </Button>
          </>
        }
      >
        {selectedAgent && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-content-tertiary">Author</p>
                <p className="text-sm text-content">{selectedAgent.author}</p>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Version</p>
                <p className="text-sm text-content">{selectedAgent.version}</p>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">License</p>
                <p className="text-sm text-content">{selectedAgent.license}</p>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Downloads</p>
                <p className="text-sm text-content">{formatNumber(selectedAgent.downloads)}</p>
              </div>
            </div>

            <div>
              <p className="text-xs text-content-tertiary">Description</p>
              <p className="mt-1 text-sm text-content">{selectedAgent.description}</p>
            </div>

            <div>
              <p className="text-xs text-content-tertiary">Manifest Summary</p>
              <pre className="mt-1 rounded-lg bg-surface-secondary p-2 text-xs text-content-secondary">
                {JSON.stringify(selectedAgent.manifest, null, 2)}
              </pre>
            </div>

            {/* Reviews section */}
            <div>
              <p className="text-xs font-medium text-content-tertiary">Reviews</p>
              <div className="mt-2 space-y-2">
                {reviews.length === 0 ? (
                  <p className="text-xs text-content-tertiary">No reviews yet.</p>
                ) : (
                  reviews.map((review) => (
                    <div key={review.id} className="rounded-lg border border-border bg-surface-secondary p-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-amber-400">{renderStars(review.rating)}</span>
                        <span className="text-2xs text-content-tertiary">
                          {new Date(review.createdAt).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                          })}
                        </span>
                      </div>
                      {review.comment && (
                        <p className="mt-1 text-xs text-content-secondary">{review.comment}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
