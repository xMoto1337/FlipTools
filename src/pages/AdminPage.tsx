import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { adminApi } from '../api/admin';
import type { AdminUser } from '../api/admin';
import { formatCurrency } from '../utils/formatters';

export default function AdminPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, isAuthenticated } = useAuthStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [counts, setCounts] = useState({ total: 0, free: 0, pro: 0, lifetime: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterTier, setFilterTier] = useState<string>('all');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin()) {
      navigate('/');
      return;
    }
    loadData();
  }, [isAuthenticated, isAdmin, navigate, location.key]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [userList, userCounts] = await Promise.all([
        adminApi.getAllUsers(),
        adminApi.getUserCount(),
      ]);
      setUsers(userList);
      setCounts(userCounts);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTierChange = async (userId: string, newTier: 'free' | 'pro' | 'lifetime') => {
    setSaving(true);
    try {
      await adminApi.updateSubscriptionTier(userId, newTier);
      await loadData();
      setEditingUser(null);
    } catch (err) {
      console.error('Failed to update tier:', err);
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      !search ||
      u.profile.email.toLowerCase().includes(search.toLowerCase()) ||
      u.profile.display_name?.toLowerCase().includes(search.toLowerCase());

    const matchesTier =
      filterTier === 'all' || (u.subscription?.tier || 'free') === filterTier;

    return matchesSearch && matchesTier;
  });

  const estimatedMRR = counts.pro * 9.99;
  const estimatedLifetimeRev = counts.lifetime * 99;

  if (!isAuthenticated || !isAdmin()) {
    return null;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Admin Panel</h1>
        <button className="btn btn-secondary" onClick={loadData} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-label">Total Users</div>
          <div className="stat-value">{counts.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Free</div>
          <div className="stat-value">{counts.free}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pro</div>
          <div className="stat-value" style={{ color: 'var(--neon-cyan)' }}>{counts.pro}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Lifetime</div>
          <div className="stat-value" style={{ color: 'var(--neon-purple)' }}>{counts.lifetime}</div>
        </div>
      </div>

      {/* Revenue Estimates */}
      <div className="stats-grid" style={{ marginBottom: 24, gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-label">Est. Monthly Revenue (MRR)</div>
          <div className="stat-value" style={{ color: 'var(--neon-green)' }}>
            {formatCurrency(estimatedMRR)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {counts.pro} Pro subscribers
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Lifetime Revenue</div>
          <div className="stat-value" style={{ color: 'var(--neon-green)' }}>
            {formatCurrency(estimatedLifetimeRev)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {counts.lifetime} lifetime purchases
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="search-input-wrapper" style={{ flex: 1, maxWidth: 'none' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="search-input"
              placeholder="Search users by email or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            value={filterTier}
            onChange={(e) => setFilterTier(e.target.value)}
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
            }}
          >
            <option value="all">All Tiers</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </div>
      </div>

      {/* User Table */}
      {loading ? (
        <div className="loading-spinner">
          <div className="spinner" />
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Tier</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    No users found
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const tier = u.subscription?.tier || 'free';
                  const status = u.subscription?.status || 'active';
                  const isEditing = editingUser === u.profile.id;

                  return (
                    <tr key={u.profile.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: '50%',
                              background: 'var(--bg-hover)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 13,
                              fontWeight: 600,
                              color: 'var(--neon-cyan)',
                              flexShrink: 0,
                            }}
                          >
                            {u.profile.display_name?.[0]?.toUpperCase() || u.profile.email[0]?.toUpperCase()}
                          </div>
                          <span>{u.profile.display_name || '—'}</span>
                          {u.profile.is_admin && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: 'var(--neon-red)',
                                color: '#fff',
                                fontWeight: 600,
                              }}
                            >
                              ADMIN
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{u.profile.email}</td>
                      <td>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            {(['free', 'pro', 'lifetime'] as const).map((t) => (
                              <button
                                key={t}
                                className={`btn ${tier === t ? 'btn-primary' : 'btn-secondary'}`}
                                style={{ padding: '4px 10px', fontSize: 12 }}
                                onClick={() => handleTierChange(u.profile.id, t)}
                                disabled={saving}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span
                            className={`platform-badge ${tier === 'pro' ? 'ebay' : tier === 'lifetime' ? 'depop' : ''}`}
                            style={{
                              background:
                                tier === 'pro'
                                  ? 'rgba(0, 255, 255, 0.1)'
                                  : tier === 'lifetime'
                                  ? 'rgba(170, 0, 255, 0.1)'
                                  : 'rgba(255, 255, 255, 0.05)',
                              color:
                                tier === 'pro'
                                  ? 'var(--neon-cyan)'
                                  : tier === 'lifetime'
                                  ? 'var(--neon-purple)'
                                  : 'var(--text-muted)',
                              border:
                                tier === 'pro'
                                  ? '1px solid rgba(0, 255, 255, 0.2)'
                                  : tier === 'lifetime'
                                  ? '1px solid rgba(170, 0, 255, 0.2)'
                                  : '1px solid var(--border-color)',
                            }}
                          >
                            {tier.charAt(0).toUpperCase() + tier.slice(1)}
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: 12,
                            color:
                              status === 'active'
                                ? 'var(--neon-green)'
                                : status === 'past_due'
                                ? 'var(--neon-orange)'
                                : 'var(--neon-red)',
                          }}
                        >
                          {status}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {new Date(u.profile.created_at).toLocaleDateString()}
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => setEditingUser(isEditing ? null : u.profile.id)}
                        >
                          {isEditing ? 'Cancel' : 'Edit'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
