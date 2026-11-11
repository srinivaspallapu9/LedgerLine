import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, ShieldAlert, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { AuthLedgerIllustration } from '../components/AuthLedgerIllustration';

export const AuthPages: React.FC = () => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (mode === 'login') {
        await login({ email, password });
      } else {
        await register({ fullName, email, password });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Authentication failed. Please try again.';
      setError(/internal server error/i.test(message)
        ? 'We could not complete your request just now. Please try again in a moment.'
        : message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-aside" aria-label="BalanceVault introduction">
        <a href="#home" className="brand">
          <span className="brand-icon"><Lock size={18} /></span>
          <span>BalanceVault</span>
        </a>
        <div className="auth-aside-copy">
          <h2>Banking built around your financial confidence.</h2>
          <p>Clear account visibility and carefully recorded financial activity, all in one secure place.</p>
        </div>
        <AuthLedgerIllustration />
        <span className="auth-aside-footnote">BalanceVault · Secure financial access</span>
      </section>

      <section className="auth-main">
        <div className="card auth-card">
          <div className="auth-heading">
            <div className="auth-mark"><Lock size={21} /></div>
            <h1>Welcome to BalanceVault</h1>
            <p>Sign in to securely access your account.</p>
          </div>

        <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab${mode === 'login' ? ' active' : ''}`}
            onClick={() => { setMode('login'); setError(null); }}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`auth-tab${mode === 'register' ? ' active' : ''}`}
            onClick={() => { setMode('register'); setError(null); }}
          >
            Open Account
          </button>
        </div>

        {error && (
          <div className="auth-error error-shake" role="alert" aria-live="polite">
            <ShieldAlert size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label className="form-label" htmlFor="auth-full-name">Full legal name</label>
              <input
                id="auth-full-name"
                type="text"
                required
                className="form-input"
                autoComplete="name"
                aria-label="Full Legal Name"
                placeholder="e.g. Ramesh Kumar"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="auth-email">Email address</label>
            <input
              id="auth-email"
              type="email"
              required
              className="form-input"
              autoComplete="email"
              aria-label="Email Address"
              placeholder="name@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
            />
            {emailTouched && email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && (
              <small className="inline-validation error">Enter an email address in the format name@domain.com.</small>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="auth-password">Password</label>
            <div className="auth-password-wrap">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                required
                className="form-input"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsLockOn(e.getModifierState('CapsLock'))}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {capsLockOn && <small className="caps-lock-hint" role="status">Caps Lock is on.</small>}
            {mode === 'register' && (
              <small className="form-hint">
                At least 8 characters with 1 uppercase letter and 1 number.
              </small>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary auth-submit"
          >
            {isLoading ? <><span className="button-spinner" aria-hidden="true" />Processing…</> : <>{mode === 'login' ? 'Sign in securely' : 'Create customer account'}<ArrowRight size={16} /></>}
          </button>
        </form>
        </div>
      </section>
    </main>
  );
};
