/**
 * Help Center — Category index with search, popular articles, and contact.
 *
 * COMPLIANCE:
 * - No PHI in help content (Rule 6)
 * - API calls use correlation IDs (Rule 3)
 * - Error fallback to mock data (Rule 7)
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { HelpSearch } from '../components/help/HelpSearch';
import {
  PlayCircle,
  BarChart3,
  Bot,
  ShieldCheck,
  Code,
  HelpCircle,
  Mail,
  Ticket,
  ArrowUpRight,
} from '../components/icons';
import {
  fetchCategories,
  type HelpCategory,
  type HelpArticle,
  mockArticles,
} from '../lib/help-api';

// --- Icon mapping ---

type IconComponentType = React.ComponentType<{ className?: string }>;

const categoryIcons: Record<string, IconComponentType> = {
  PlayCircle,
  BarChart3,
  Bot,
  ShieldCheck,
  Code,
  HelpCircle,
};

// --- Component ---

export function HelpCenter(): ReactNode {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<HelpCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCategories();
      setCategories(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const handleArticleSelect = useCallback(
    (article: HelpArticle) => {
      void navigate(`/help/article/${article.slug}`);
    },
    [navigate],
  );

  // Popular articles: top 5 by helpfulYes
  const popularArticles = [...mockArticles].sort((a, b) => b.helpfulYes - a.helpfulYes).slice(0, 5);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading help center" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="page-title text-2xl">Help Center</h1>
        <p className="page-subtitle mt-2">
          Find answers, guides, and documentation for ORDR-Connect
        </p>
        <div className="mx-auto mt-6 max-w-xl">
          <HelpSearch onSelect={handleArticleSelect} />
        </div>
      </div>

      {/* Category Grid */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-tertiary">
          Browse by Category
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => {
            const Icon = categoryIcons[cat.icon] ?? HelpCircle;
            return (
              <button
                key={cat.id}
                onClick={() => navigate(`/help/category/${cat.id}`)}
                className="group text-left"
              >
                <Card className="h-full transition-all duration-200 group-hover:border-border-focus">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-accent/15">
                        <Icon className="h-5 w-5 text-brand-accent" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-content">{cat.name}</h3>
                        <p className="text-xs text-content-tertiary">
                          {cat.articleCount} article{cat.articleCount !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <ArrowUpRight className="h-4 w-4 text-content-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <p className="line-clamp-2 text-xs text-content-secondary">{cat.description}</p>
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      </div>

      {/* Popular Articles */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-tertiary">
          Popular Articles
        </h2>
        <Card className="mt-4">
          <div className="divide-y divide-border">
            {popularArticles.map((article) => (
              <button
                key={article.id}
                onClick={() => navigate(`/help/article/${article.slug}`)}
                className="flex w-full items-center justify-between px-1 py-3 text-left transition-colors first:pt-0 last:pb-0 hover:text-brand-accent"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-content">{article.title}</p>
                  <p className="mt-0.5 text-xs text-content-tertiary">
                    {article.helpfulYes} people found this helpful
                  </p>
                </div>
                <ArrowUpRight className="ml-3 h-4 w-4 shrink-0 text-content-tertiary" />
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Need More Help */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-tertiary">
          Need More Help?
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
                <Ticket className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-content">Submit a Ticket</h3>
                <p className="mt-1 text-xs text-content-secondary">
                  Create a support ticket and our team will respond within our SLA commitments.
                  Critical issues receive a response within 1 hour.
                </p>
                <button
                  onClick={() => navigate('/tickets')}
                  className="mt-3 text-xs font-medium text-brand-accent transition-colors hover:text-blue-300"
                >
                  Go to Tickets
                </button>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/15">
                <Mail className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-content">Contact Support</h3>
                <p className="mt-1 text-xs text-content-secondary">
                  Reach our support team directly via email. All communications are encrypted and
                  logged in the compliance audit trail.
                </p>
                <p className="mt-3 text-xs font-medium text-brand-accent">
                  support@ordr-connect.com
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
