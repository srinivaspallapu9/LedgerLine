import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Shield, CreditCard, ArrowLeftRight, Users, Activity, LogOut, Lock, Menu, X, LayoutDashboard, type LucideIcon } from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, setCurrentTab }) => {
  const { user, logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  if (!user) return null;

  const navigate = (tab: string) => {
    setCurrentTab(tab);
    setIsMenuOpen(false);
  };

  const navItems: { tab: string; label: string; icon: LucideIcon; matches: string[] }[] =
    user.role === 'ACCOUNT_HOLDER'
      ? [
          { tab: 'dashboard', label: 'Accounts & Overview', icon: LayoutDashboard, matches: ['dashboard'] },
          { tab: 'transactions', label: 'Transaction History', icon: ArrowLeftRight, matches: ['transactions'] },
        ]
      : user.role === 'ADMIN'
        ? [
            { tab: 'admin-dashboard', label: 'System Dashboard', icon: Activity, matches: ['admin-dashboard', 'dashboard'] },
            { tab: 'admin-users', label: 'User Management', icon: Users, matches: ['admin-users'] },
            { tab: 'admin-accounts', label: 'All Accounts', icon: CreditCard, matches: ['admin-accounts'] },
            { tab: 'admin-audit', label: 'Security Audit Logs', icon: Shield, matches: ['admin-audit'] },
          ]
        : [
            { tab: 'auditor-metrics', label: 'Financial Overview', icon: Activity, matches: ['auditor-metrics', 'dashboard'] },
            { tab: 'auditor-transactions', label: 'Ledger Examination', icon: ArrowLeftRight, matches: ['auditor-transactions'] },
            { tab: 'auditor-logs', label: 'Compliance Audit Trail', icon: Shield, matches: ['auditor-logs'] },
          ];
  const activeNavIndex = Math.max(0, navItems.findIndex((item) => item.matches.includes(currentTab)));

  const pageTitle =
    currentTab === 'transactions' || currentTab === 'auditor-transactions'
      ? 'Transaction history'
      : currentTab === 'admin-users'
        ? 'User management'
        : currentTab === 'admin-accounts'
          ? 'Account registry'
          : currentTab === 'admin-audit' || currentTab === 'auditor-logs'
            ? 'Audit & compliance'
            : currentTab.startsWith('auditor-')
              ? 'Financial overview'
              : user.role === 'ADMIN'
                ? 'System overview'
                : 'Account overview';

  const initials = user.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <>
      {isMenuOpen && (
        <button
          type="button"
          className="mobile-nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setIsMenuOpen(false)}
        />
      )}
      <button
        type="button"
        className="mobile-menu-button"
        aria-label={isMenuOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={isMenuOpen}
        onClick={() => setIsMenuOpen((open) => !open)}
      >
        {isMenuOpen ? <X size={19} /> : <Menu size={19} />}
      </button>
      <aside className={`navbar${isMenuOpen ? ' mobile-open' : ''}`} aria-label="Main navigation">
        <a href="#home" onClick={() => navigate('dashboard')} className="brand">
          <div className="brand-icon"><Lock size={18} /></div>
          <span>BalanceVault</span>
        </a>

        <nav className="nav-links" aria-label="Primary">
          <span
            className="nav-indicator"
            aria-hidden="true"
            style={{ transform: `translateY(${activeNavIndex * 51}px)` }}
          />
          {navItems.map(({ tab, label, icon: Icon, matches }) => (
            <button
              type="button"
              key={tab}
              className={`nav-link${matches.includes(currentTab) ? ' active' : ''}`}
              aria-current={matches.includes(currentTab) ? 'page' : undefined}
              onClick={() => navigate(tab)}
            >
              <Icon size={17} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <div className="navbar-user">
          <div className="user-pill">
            <span className="user-name">{user.fullName}</span>
            <span className="role-label">{user.role.replace('_', ' ')}</span>
          </div>
          <button type="button" onClick={() => logout()} className="btn btn-secondary btn-sm" title="Sign Out" aria-label="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      <header className="topbar">
        <span className="topbar-label">{pageTitle}</span>
        <div className="user-pill">
          <span className="avatar-mark" aria-hidden="true">{initials}</span>
          <span className="user-name">{user.fullName}</span>
          <span className={`badge ${user.role === 'ADMIN' ? 'badge-danger' : user.role === 'AUDITOR' ? 'badge-warning' : 'badge-info'}`}>
            {user.role.replace('_', ' ')}
          </span>
        </div>
      </header>
    </>
  );
};
