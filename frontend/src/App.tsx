import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { AuthPages } from './pages/AuthPages';
import { CustomerDashboard } from './pages/CustomerDashboard';
import { TransactionHistoryPage } from './pages/TransactionHistoryPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { AuditorView } from './pages/AuditorView';

const MainLayout: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [currentTab, setCurrentTab] = useState<string>('dashboard');

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div style={{ textAlign: 'center' }} role="status" aria-live="polite">
          <div className="loading-brand">
            BalanceVault
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Checking your secure session…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPages />;
  }

  return (
    <div className="app-container">
      <Navbar currentTab={currentTab} setCurrentTab={setCurrentTab} />

      <main className="main-content">
        {user.role === 'ACCOUNT_HOLDER' && (
          <>
            {currentTab === 'dashboard' && <CustomerDashboard onViewTransactions={() => setCurrentTab('transactions')} />}
            {currentTab === 'transactions' && <TransactionHistoryPage />}
          </>
        )}

        {user.role === 'ADMIN' && (
          <>
            {currentTab === 'admin-dashboard' && <AdminDashboard activeTab="overview" />}
            {currentTab === 'admin-users' && <AdminDashboard activeTab="users" />}
            {currentTab === 'admin-accounts' && <AdminDashboard activeTab="accounts" />}
            {currentTab === 'admin-audit' && <AdminDashboard activeTab="audit" />}
            {currentTab === 'dashboard' && <AdminDashboard activeTab="overview" />}
          </>
        )}

        {user.role === 'AUDITOR' && (
          <>
            {currentTab === 'auditor-transactions' && <AuditorView activeTab="transactions" />}
            {currentTab === 'auditor-logs' && <AuditorView activeTab="audit" />}
            {currentTab === 'auditor-metrics' && <AuditorView activeTab="transactions" />}
            {currentTab === 'dashboard' && <AuditorView activeTab="transactions" />}
          </>
        )}
      </main>

      <footer className="app-footer">
        BalanceVault · Secure INR banking
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <MainLayout />
    </AuthProvider>
  );
};

export default App;
