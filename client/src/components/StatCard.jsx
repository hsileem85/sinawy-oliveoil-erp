import React from 'react';

export default function StatCard({ label, value, sub, icon: Icon, tone = 'olive' }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <span className="stat-label">{label}</span>
        {Icon && (
          <div className={`stat-icon ${tone}`}>
            <Icon size={18} />
          </div>
        )}
      </div>
      <div className="stat-value num">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
