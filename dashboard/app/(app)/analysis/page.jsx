'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

// ── Severity helpers ──────────────────────────────────────────────────────
const SEV = {
  critical: { color: '#f87171', bg: '#f8717120', border: '#f87171' },
  high:     { color: '#fb923c', bg: '#fb923c20', border: '#fb923c' },
  medium:   { color: '#fbbf24', bg: '#fbbf2420', border: '#fbbf24' },
  low:      { color: '#34d399', bg: '#34d39920', border: '#34d399' },
};

const CAT_ICON = {
  authentication: '🔑',
  webserver:      '🌐',
  firewall:       '🧱',
  system:         '⚙️',
  exposure:       '📡',
};

const CAT_LABEL = {
  authentication: 'Authentication',
  webserver:      'Web Server',
  firewall:       'Firewall',
  system:         'System',
  exposure:       'Service Exposure',
};

const WINDOW_OPTIONS = [
  { label: '6 h',  value: 6 },
  { label: '24 h', value: 24 },
  { label: '7 d',  value: 168 },
];

// ── Score gauge ───────────────────────────────────────────────────────────
function ScoreGauge({ score, grade }) {
  const capped = Math.min(100, Math.max(0, score));
  const STROKE = 10;
  const R = 54;
  const C = 2 * Math.PI * R;
  const dash = (capped / 100) * C;
  const color = score >= 75 ? '#34d399' : score >= 50 ? '#fbbf24' : score >= 25 ? '#fb923c' : '#f87171';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={140} height={140} viewBox="0 0 130 130">
        <circle cx="65" cy="65" r={R} fill="none" stroke="var(--panel-2)" strokeWidth={STROKE} />
        <circle cx="65" cy="65" r={R} fill="none"
          stroke={color} strokeWidth={STROKE}
          strokeDasharray={`${dash} ${C - dash}`}
          strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '65px 65px' }}
        />
        <text x="65" y="60" textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 28, fontWeight: 700, fill: color }}>{score}</text>
        <text x="65" y="82" textAnchor="middle"
          style={{ fontSize: 22, fontWeight: 700, fill: color }}>{grade}</text>
      </svg>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Security Score</div>
    </div>
  );
}

// ── Posture summary bar ───────────────────────────────────────────────────
function PostureSummary({ finding_counts }) {
  const bars = [
    { sev: 'critical', label: 'Critical' },
    { sev: 'high',     label: 'High' },
    { sev: 'medium',   label: 'Medium' },
    { sev: 'low',      label: 'Low' },
  ];
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {bars.map(({ sev, label }) => {
        const count = finding_counts?.[sev] ?? 0;
        const s = SEV[sev];
        return (
          <div key={sev} style={{
            flex: 1, padding: '12px 14px', borderRadius: 8,
            background: count > 0 ? s.bg : 'var(--panel-2)',
            border: `1px solid ${count > 0 ? s.border : 'var(--border)'}`,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: count > 0 ? s.color : 'var(--muted)' }}>{count}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Finding card ──────────────────────────────────────────────────────────
function FindingCard({ finding }) {
  const [open, setOpen] = useState(finding.severity === 'critical');
  const [copied, setCopied] = useState(null);
  const s = SEV[finding.severity] || SEV.low;

  const copyCmd = (cmd, idx) => {
    if (!cmd) return;
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(idx);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div style={{
      border: `1px solid ${s.border}40`,
      borderLeft: `4px solid ${s.border}`,
      borderRadius: 8,
      marginBottom: 10,
      background: 'var(--panel)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{
          padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
          background: s.bg, color: s.color, border: `1px solid ${s.border}`,
          textTransform: 'uppercase', flexShrink: 0,
        }}>{finding.severity}</span>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>
          {CAT_ICON[finding.category] || '🔍'} {finding.title}
        </span>
        <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>
          {finding.count > 1 ? `${finding.count} events` : ''}
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 16 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '0 16px 16px' }}>
          {/* Description */}
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.6 }}>
            {finding.description}
          </p>

          {/* Evidence */}
          {finding.evidence?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                Evidence
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {finding.evidence.map((ev, i) => (
                  <div key={i} style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 12,
                    background: 'var(--panel-2)', border: '1px solid var(--border)',
                  }}>
                    <span style={{ color: 'var(--muted)' }}>{ev.label}: </span>
                    <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{ev.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Remediation */}
          {finding.remediation?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Remediation Steps
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {finding.remediation.map((step, i) => (
                  <div key={i} style={{
                    borderRadius: 6, overflow: 'hidden',
                    border: '1px solid var(--border)',
                    background: 'var(--panel-2)',
                  }}>
                    <div style={{ padding: '8px 12px', fontSize: 13 }}>
                      <span style={{ color: s.color, fontWeight: 700, marginRight: 6 }}>{i + 1}.</span>
                      {step.step}
                    </div>
                    {step.command && (
                      <div style={{
                        padding: '8px 12px', background: '#0d1117',
                        borderTop: '1px solid var(--border)',
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                      }}>
                        <pre style={{
                          flex: 1, margin: 0, fontSize: 12, fontFamily: 'monospace',
                          color: '#e6edf3', overflowX: 'auto', whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}>{step.command}</pre>
                        <button
                          onClick={() => copyCmd(step.command, i)}
                          style={{
                            flexShrink: 0, padding: '4px 8px', borderRadius: 4, border: '1px solid #30363d',
                            background: copied === i ? '#34d39922' : '#161b22',
                            color: copied === i ? '#34d399' : '#8b949e',
                            cursor: 'pointer', fontSize: 11,
                          }}>
                          {copied === i ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timestamps */}
          {(finding.first_seen || finding.last_seen) && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 16 }}>
              {finding.first_seen && <span>First seen: {new Date(finding.first_seen).toLocaleString()}</span>}
              {finding.last_seen  && <span>Last seen: {new Date(finding.last_seen).toLocaleString()}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Category section ─────────────────────────────────────────────────────
function CategorySection({ category, findings }) {
  if (!findings.length) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
        letterSpacing: '0.06em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{CAT_ICON[category]}</span>
        <span>{CAT_LABEL[category]}</span>
        <span style={{ background: 'var(--panel-2)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>{findings.length}</span>
      </div>
      {findings.map((f) => <FindingCard key={f.id} finding={f} />)}
    </div>
  );
}

// ── Server overview card (all-servers view) ───────────────────────────────
function ServerPostureCard({ posture, onClick, active }) {
  const s = SEV[posture.grade === 'A' ? 'low' : posture.grade === 'B' ? 'medium' :
             posture.grade === 'C' ? 'high' : 'critical'] || SEV.critical;
  const scoreColor = posture.score >= 75 ? '#34d399' : posture.score >= 50 ? '#fbbf24' :
                     posture.score >= 25 ? '#fb923c' : '#f87171';
  return (
    <div onClick={onClick} style={{
      padding: '14px 16px', borderRadius: 8, cursor: 'pointer',
      background: active ? 'var(--accent)15' : 'var(--panel)',
      border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      transition: 'all .15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{posture.server_name}</span>
        <span style={{
          fontSize: 22, fontWeight: 900, color: scoreColor,
          lineHeight: 1,
        }}>{posture.grade}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
        {['critical','high','medium','low'].map((sev) => {
          const c = posture.finding_counts?.[sev] ?? 0;
          if (!c) return null;
          return (
            <span key={sev} style={{
              padding: '1px 6px', borderRadius: 8, fontWeight: 700,
              background: SEV[sev].bg, color: SEV[sev].color, border: `1px solid ${SEV[sev].border}`,
            }}>{c} {sev}</span>
          );
        })}
        {!Object.values(posture.finding_counts || {}).some(Boolean) && (
          <span style={{ color: '#34d399', fontWeight: 600 }}>✓ No issues found</span>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function AnalysisPage() {
  const [postureList, setPostureList] = useState([]);
  const [selected, setSelected]   = useState(null);
  const [window, setWindow]        = useState(24);
  const [loading, setLoading]      = useState(false);
  const [error, setError]          = useState('');

  const load = useCallback(async (w) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getAnalysisAll(w);
      setPostureList(data);
      if (data.length && !selected) setSelected(data[0].server_id);
    } catch (e) {
      setError(e.message || 'Failed to load analysis');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(window); }, [window]); // eslint-disable-line react-hooks/exhaustive-deps

  const activePosture = postureList.find((p) => p.server_id === selected);

  // Group findings by category
  const categories = ['authentication', 'webserver', 'firewall', 'system', 'exposure'];
  const byCategory = (findings) => {
    const map = {};
    for (const cat of categories) map[cat] = [];
    for (const f of (findings || [])) {
      if (map[f.category]) map[f.category].push(f);
    }
    return map;
  };

  return (
    <div>
      {/* Page header */}
      <div className="page-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Security Analysis & Fix Suggestions</h2>
          <span className="muted">Analysed from collected security events — all findings include remediation steps</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {WINDOW_OPTIONS.map((o) => (
            <button key={o.value} onClick={() => setWindow(o.value)}
              style={{
                padding: '6px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
                border: `1px solid ${window === o.value ? 'var(--accent)' : 'var(--border)'}`,
                background: window === o.value ? 'var(--accent)22' : 'var(--panel-2)',
                color: window === o.value ? 'var(--accent)' : 'var(--fg, var(--text))',
                fontWeight: window === o.value ? 700 : 400,
              }}>{o.label}</button>
          ))}
          <button onClick={() => load(window)} disabled={loading}
            style={{
              padding: '6px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
              border: '1px solid var(--border)', background: 'var(--panel-2)',
              color: 'var(--fg, var(--text))',
            }}>{loading ? '⟳' : '↺ Refresh'}</button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: 8, marginBottom: 16,
          background: '#fee2e222', border: '1px solid #f87171', color: '#f87171', fontSize: 13,
        }}>{error}</div>
      )}

      {loading && !postureList.length ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 14 }}>
          Analysing security data…
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>

          {/* Left: server list */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
              letterSpacing: '0.06em', marginBottom: 8 }}>Servers ({postureList.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {postureList.map((p) => (
                <ServerPostureCard key={p.server_id} posture={p}
                  active={p.server_id === selected}
                  onClick={() => setSelected(p.server_id)}
                />
              ))}
              {!postureList.length && !loading && (
                <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 20 }}>
                  No servers found
                </div>
              )}
            </div>
          </div>

          {/* Right: selected server detail */}
          <div>
            {activePosture ? (
              <>
                {/* Score + summary row */}
                <div style={{
                  display: 'flex', gap: 20, padding: 20, marginBottom: 20,
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10,
                  alignItems: 'center', flexWrap: 'wrap',
                }}>
                  <ScoreGauge score={activePosture.score} grade={activePosture.grade} />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{activePosture.server_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                      {activePosture.findings.length === 0
                        ? '✅ No security issues found in the selected window'
                        : `${activePosture.findings.length} issue${activePosture.findings.length > 1 ? 's' : ''} found — fix prioritised by severity`}
                    </div>
                    <PostureSummary finding_counts={activePosture.finding_counts} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'flex-end' }}>
                    Analysed: {new Date(activePosture.generated_at).toLocaleTimeString()}
                  </div>
                </div>

                {/* Findings by category */}
                {activePosture.findings.length === 0 ? (
                  <div style={{
                    padding: 32, textAlign: 'center', background: 'var(--panel)',
                    border: '1px solid #34d39940', borderRadius: 10, color: '#34d399',
                  }}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>No issues detected</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                      No security findings in the last {window}h. Keep monitoring — the analysis refreshes on demand.
                    </div>
                  </div>
                ) : (
                  (() => {
                    const grouped = byCategory(activePosture.findings);
                    return categories.map((cat) => (
                      <CategorySection key={cat} category={cat} findings={grouped[cat]} />
                    ));
                  })()
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 14 }}>
                Select a server to see its security analysis
              </div>
            )}
          </div>

        </div>
      )}

      {/* Legend */}
      <div style={{
        marginTop: 24, padding: '12px 16px', borderRadius: 8,
        background: 'var(--panel)', border: '1px solid var(--border)',
        fontSize: 12, color: 'var(--muted)', lineHeight: 1.7,
      }}>
        <strong style={{ color: 'var(--fg, var(--text))' }}>How this works:</strong> Analysis runs against the last {window}h of collected security events, metrics, and system snapshots.
        New data types (nginx access logs, open port snapshots, firewall status) require the updated agent to be deployed.
        Findings are generated automatically — no manual configuration required.
        Remediation commands are suggestions; always review before running in production.
      </div>
    </div>
  );
}
