'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Accessible, scalable multi-select for picking target servers.
 *
 * Props:
 *   servers  : array of monitored servers ({ id, name, hostname, ip_address, os,
 *              status, last_seen, tags, product_name })
 *   selected : array of selected server ids
 *   onChange : (ids: string[]) => void
 *
 * Features: responsive auto-fit card grid (no horizontal scroll), sticky header
 * with live selected count + Select all / Clear, real-time search over name /
 * hostname / IP / tags, online-offline + agent-heartbeat indicators, full row
 * toggle, keyboard + ARIA support, and incremental rendering for large fleets.
 */
const HEARTBEAT_MS = 2 * 60 * 1000; // agent considered connected if seen within 2 min
const OFFLINE_MS = 5 * 60 * 1000;
const PAGE = 60; // cards rendered per incremental window

function tagText(tags) {
  if (!tags || typeof tags !== 'object') return '';
  return Object.entries(tags).map(([k, v]) => `${k}:${v}`).join(' ');
}

function deriveState(s) {
  const seen = s.last_seen ? Date.now() - new Date(s.last_seen).getTime() : Infinity;
  const explicitOnline = ['online', 'active', 'up'].includes(s.status);
  const explicitOffline = ['offline', 'down', 'inactive'].includes(s.status);
  const online = explicitOnline ? seen < OFFLINE_MS : !explicitOffline && seen < OFFLINE_MS;
  return {
    online,
    statusColor: online ? '#22c55e' : '#ef4444',
    statusLabel: online ? 'online' : 'offline',
    agentConnected: seen < HEARTBEAT_MS,
    env: s.tags?.env || s.tags?.environment || s.product_name || null,
  };
}

export default function ServerMultiSelect({ servers = [], selected = [], onChange }) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const sentinelRef = useRef(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter((s) =>
      `${s.name} ${s.hostname || ''} ${s.ip_address || ''} ${tagText(s.tags)}`
        .toLowerCase()
        .includes(q));
  }, [servers, query]);

  useEffect(() => { setLimit(PAGE); }, [query]);

  // Incremental rendering: reveal more cards as the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || filtered.length <= limit) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setLimit((n) => Math.min(n + PAGE, filtered.length));
    }, { root: el.closest('.srvms-body') });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, limit]);

  const visible = filtered.slice(0, limit);
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((s) => selectedSet.has(s.id));

  const toggle = (id) =>
    onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const selectAllFiltered = () => {
    if (allFilteredSelected) {
      const ids = new Set(filtered.map((s) => s.id));
      onChange(selected.filter((id) => !ids.has(id)));
    } else {
      onChange([...new Set([...selected, ...filtered.map((s) => s.id)])]);
    }
  };

  return (
    <div className="srvms" role="group" aria-label="Target servers">
      <div className="srvms-header">
        <div className="srvms-actions">
          <span className="srvms-count" aria-live="polite">
            {selected.length} selected
          </span>
          <div className="srvms-action-btns">
            <button type="button" onClick={selectAllFiltered} disabled={filtered.length === 0}>
              {allFilteredSelected ? 'Clear all' : 'Select all'}
              {query && filtered.length !== servers.length ? ' (filtered)' : ''}
            </button>
            <button type="button" onClick={() => onChange([])} disabled={selected.length === 0}>
              Clear selection
            </button>
          </div>
        </div>
        <input
          type="search"
          className="srvms-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, hostname, IP or tag…"
          aria-label="Search servers"
        />
      </div>

      <div className="srvms-body">
        {servers.length === 0 && (
          <div className="srvms-empty">No monitored servers. Add servers on the Servers page first.</div>
        )}
        {servers.length > 0 && filtered.length === 0 && (
          <div className="srvms-empty">No servers match “{query}”.</div>
        )}

        <div className="srvms-grid">
          {visible.map((s) => {
            const d = deriveState(s);
            const isSel = selectedSet.has(s.id);
            return (
              <div
                key={s.id}
                role="checkbox"
                aria-checked={isSel}
                aria-label={`${s.name}, ${d.statusLabel}${d.env ? `, ${d.env}` : ''}`}
                tabIndex={0}
                onClick={() => toggle(s.id)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(s.id); }
                }}
                className={`srvms-card${isSel ? ' is-selected' : ''}`}
              >
                <span className="srvms-check" aria-hidden="true">
                  {isSel ? '✓' : ''}
                </span>
                <span
                  className="srvms-dot"
                  title={d.statusLabel}
                  style={{ background: d.statusColor, boxShadow: `0 0 6px ${d.statusColor}` }}
                />
                <div className="srvms-info">
                  <div className="srvms-name">{s.name}</div>
                  <div className="srvms-host" title={s.hostname || s.ip_address || ''}>
                    {s.hostname || s.ip_address || '—'}{s.ip_address && s.hostname ? ` · ${s.ip_address}` : ''}
                  </div>
                  <div className="srvms-badges">
                    {d.env && <span className="srvms-badge srvms-env">{d.env}</span>}
                    <span className={`srvms-badge ${d.online ? 'srvms-on' : 'srvms-off'}`}>
                      {d.statusLabel}
                    </span>
                    <span
                      className={`srvms-badge ${d.agentConnected ? 'srvms-agent-on' : 'srvms-agent-off'}`}
                      title={d.agentConnected ? 'Agent heartbeat recent' : 'No recent agent heartbeat'}
                    >
                      ● agent {d.agentConnected ? 'connected' : 'idle'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length > limit && (
          <div ref={sentinelRef} className="srvms-more">
            Showing {limit} of {filtered.length}… scroll for more
          </div>
        )}
      </div>
    </div>
  );
}
