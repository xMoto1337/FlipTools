import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { supabase } from '../api/supabase';
import { formatCurrency } from '../utils/formatters';

export default function InventoryPage() {
  const { isAuthenticated } = useAuthStore();
  const { requireAuth } = useRequireAuth();
  const {
    items,
    searchQuery,
    categoryFilter,
    isLoading,
    setItems,
    addItem,
    removeItem,
    setSearchQuery,
    setCategoryFilter,
    setLoading,
    filteredItems,
    totalValue,
    totalItems,
  } = useInventoryStore();

  const location = useLocation();
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    cost: 0,
    quantity: 1,
    category: '',
    location: '',
    sku: '',
  });

  useEffect(() => {
    if (!isAuthenticated) return;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('inventory')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && data) setItems(data);
      } catch (err) {
        console.error('Inventory load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAuthenticated, location.key]);

  const handleAdd = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('inventory')
        .insert({ user_id: user.id, ...formData, images: [] })
        .select()
        .single();

      if (!error && data) {
        addItem(data);
        setShowAddForm(false);
        setFormData({ name: '', description: '', cost: 0, quantity: 1, category: '', location: '', sku: '' });
      }
    } catch (err) {
      console.error('Add inventory error:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await supabase.from('inventory').delete().eq('id', id);
      removeItem(id);
    } catch (err) {
      console.error('Delete inventory error:', err);
    }
  };

  const filtered = filteredItems();

  return (
    <div>
      <div className="page-header">
        <h1>Inventory</h1>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={requireAuth(() => setShowAddForm(true), 'Sign in to track inventory')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Item
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Inventory Value</div>
          <div className="stat-value">{formatCurrency(totalValue())}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Items</div>
          <div className="stat-value">{totalItems()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unique Products</div>
          <div className="stat-value">{items.length}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <div className="search-input-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className="search-input" placeholder="Search inventory..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          <select className="filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All Categories</option>
            <option value="clothing">Clothing</option>
            <option value="shoes">Shoes</option>
            <option value="electronics">Electronics</option>
            <option value="collectibles">Collectibles</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="loading-spinner"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          <h3>No inventory items</h3>
          <p>Track your inventory to know your costs and profit margins</p>
          <button className="btn btn-primary" onClick={requireAuth(() => setShowAddForm(true), 'Sign in to track inventory')}>Add First Item</button>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Cost</th>
              <th>Qty</th>
              <th>Total Value</th>
              <th>Category</th>
              <th>Location</th>
              <th>SKU</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td style={{ fontWeight: 500 }}>{item.name}</td>
                <td>{formatCurrency(item.cost || 0)}</td>
                <td>{item.quantity}</td>
                <td style={{ color: 'var(--neon-cyan)' }}>{formatCurrency((item.cost || 0) * item.quantity)}</td>
                <td style={{ color: 'var(--text-muted)' }}>{item.category || '-'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{item.location || '-'}</td>
                <td style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}>{item.sku || '-'}</td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(item.id)} style={{ color: 'var(--neon-red)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add Item Modal */}
      {showAddForm && (
        <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Add Inventory Item</div>
              <button className="modal-close" onClick={() => setShowAddForm(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Item Name</label>
                <input className="form-input" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Item name" />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-input form-textarea" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Optional description" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Cost ($)</label>
                  <input type="number" className="form-input" value={formData.cost || ''} onChange={(e) => setFormData({ ...formData, cost: Number(e.target.value) })} placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Quantity</label>
                  <input type="number" className="form-input" value={formData.quantity} onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })} min={1} />
                </div>
                <div className="form-group">
                  <label className="form-label">SKU</label>
                  <input className="form-input" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} placeholder="Optional" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select className="form-input form-select" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })}>
                    <option value="">Select...</option>
                    <option value="clothing">Clothing</option>
                    <option value="shoes">Shoes</option>
                    <option value="electronics">Electronics</option>
                    <option value="collectibles">Collectibles</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Storage Location</label>
                  <input className="form-input" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} placeholder="Shelf A, Box 3, etc." />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={!formData.name}>Add Item</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
