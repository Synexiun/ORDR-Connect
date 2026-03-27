import { type ReactNode, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ApiRequestError } from '../lib/api';

export function Login(): ReactNode {
  const { login, loginDemo, isLoading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);

      if (!email.trim() || !password.trim()) {
        setError('Email and password are required.');
        return;
      }

      try {
        await login({ email: email.trim(), password });
        void navigate('/dashboard', { replace: true });
      } catch (err) {
        if (err instanceof ApiRequestError) {
          if (err.status === 429) {
            setError('Too many login attempts. Please wait before trying again.');
          } else if (err.status === 401) {
            setError('Invalid email or password.');
          } else {
            setError(`Authentication failed. Reference: ${err.correlationId}`);
          }
        } else {
          setError('Unable to connect. Please try again.');
        }
      }
    },
    [email, password, login, navigate],
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-accent text-sm font-bold text-white">
            O
          </div>
          <h1 className="font-mono text-xl font-bold tracking-tight text-content">
            ORDR<span className="text-content-tertiary">.</span>Connect
          </h1>
          <p className="mt-1 text-sm text-content-secondary">Customer Operations OS</p>
        </div>

        {/* Login form */}
        <div className="rounded-xl border border-border bg-surface-secondary p-6">
          <h2 className="mb-6 text-base font-semibold text-content">Sign in to your account</h2>

          <form onSubmit={handleSubmit} noValidate>
            <div className="space-y-4">
              <Input
                label="Email address"
                type="email"
                placeholder="operator@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                autoComplete="email"
                autoFocus
                required
                disabled={isLoading}
              />

              <Input
                label="Password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
                autoComplete="current-password"
                required
                disabled={isLoading}
              />
            </div>

            {error !== null && (
              <div
                className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
                role="alert"
                aria-live="polite"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="mt-6 w-full"
              size="lg"
              loading={isLoading}
              disabled={isLoading}
            >
              Sign In
            </Button>
          </form>

          <div className="mt-4 border-t border-border pt-4">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => {
                loginDemo();
                void navigate('/dashboard', { replace: true });
              }}
              disabled={isLoading}
            >
              Launch Demo
            </Button>
            <p className="mt-2 text-center text-2xs text-content-tertiary">
              Explore the dashboard with sample data
            </p>
          </div>
        </div>

        {/* Compliance footer */}
        <div className="mt-6 text-center">
          <div className="flex items-center justify-center gap-3 text-2xs text-content-tertiary">
            <span>SOC 2</span>
            <span className="text-border">{'\u2022'}</span>
            <span>ISO 27001</span>
            <span className="text-border">{'\u2022'}</span>
            <span>HIPAA</span>
          </div>
          <p className="mt-2 text-2xs text-content-tertiary">
            All sessions are monitored and audit-logged.
          </p>
        </div>
      </div>
    </div>
  );
}
