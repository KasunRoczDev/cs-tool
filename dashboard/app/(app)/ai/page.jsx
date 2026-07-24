'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const LV = { low: '#22c55e', medium: '#eab308', high: '#ef4444' };

function ScoreBar({ score, level }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--panel-2)', overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: LV[level] || '#64748b' }} />
      </div>
      <b style={{ color: LV[level] || '#64748b', minWidth: 64, textAlign: 'right' }}>{score}/100 {level}</b>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </div>
  );
}

export default function AiPage() {
  const [llm, setLlm] = useState(null);
  const [releases, setReleases] = useState([]);
  const [repos, setRepos] = useState([]);
  const [err, setErr] = useState('');

  const [relId, setRelId] = useState('');
  const [channel, setChannel] = useState('production');
  const [risk, setRisk] = useState(null);
  const [predict, setPredict] = useState(null);
  const [plan, setPlan] = useState(null);
  const [notes, setNotes] = useState(null);

  const [repoId, setRepoId] = useState('');
  const [risky, setRisky] = useState(null);
  const [prNum, setPrNum] = useState('');
  const [reviewers, setReviewers] = useState(null);
  const [breaking, setBreaking] = useState(null);

  const [hours, setHours] = useState(72);
  const [incidents, setIncidents] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api.aiStatus().then(setLlm).catch(() => {});
    api.releases().then(setReleases).catch(() => {});
    api.repositories().then(setRepos).catch(() => {});
  }, []);

  const run = async (key, fn, setter) => {
    setErr(''); setBusy(key); setter(null);
    try { setter(await fn()); } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };

  return (
    <div>
      <div className="page-head"><h2>🤖 AI Assistant</h2></div>
      {err && <div className="error">{err}</div>}

      <div className="hint" style={{ marginBottom: 16 }}>
        Release intelligence computed from your own data (deployments, jobs, PRs, commits, alerts).
        {llm && (llm.llm.enabled
          ? <> LLM enrichment <b style={{ color: '#22c55e' }}>on</b> ({llm.llm.provider}/{llm.llm.model}).</>
          : <> LLM enrichment <b style={{ color: 'var(--muted)' }}>off</b> — set <code>AI_API_KEY</code> to add narrative summaries. All scores work without it.</>)}
      </div>

      {/* ── Release intelligence ── */}
      <Section title="📦 Release risk, failure prediction & rollback">
        <div className="inline-form" style={{ marginBottom: 12 }}>
          <select value={relId} onChange={(e) => setRelId(e.target.value)}>
            <option value="">— select release —</option>
            {releases.map((r) => <option key={r.id} value={r.id}>{r.version}{r.name ? ` — ${r.name}` : ''}</option>)}
          </select>
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {['canary', 'beta', 'production', 'enterprise'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button disabled={!relId || busy} onClick={() => run('risk', () => api.aiRisk(relId, channel), setRisk)}>Estimate risk</button>
          <button disabled={!relId || busy} onClick={() => run('predict', () => api.aiPredict(relId, channel), setPredict)}>Predict failure</button>
          <button disabled={!relId || busy} onClick={() => run('plan', () => api.aiRollbackPlan(relId, channel), setPlan)}>Rollback plan</button>
          <button disabled={!relId || busy} onClick={() => run('notes', () => api.aiReleaseNotes(relId), setNotes)}>AI release notes</button>
        </div>

        {risk && (
          <div style={{ marginBottom: 14 }}>
            <h4 style={{ margin: '6px 0' }}>Release risk — {risk.release_version} → {risk.channel}</h4>
            <ScoreBar score={risk.score} level={risk.level} />
            <ul style={{ margin: '10px 0' }}>
              {risk.factors.map((f, i) => (
                <li key={i}><b>+{f.points}</b> {f.label}{f.detail ? <span style={{ color: 'var(--muted)' }}> — {f.detail}</span> : ''}</li>
              ))}
            </ul>
            <p><b>Recommendation:</b> {risk.recommendation}</p>
            {risk.narrative && <p style={{ color: 'var(--muted)' }}>💬 {risk.narrative}</p>}
          </div>
        )}

        {predict && (
          <div style={{ marginBottom: 14 }}>
            <h4 style={{ margin: '6px 0' }}>Deployment failure prediction</h4>
            <ScoreBar score={predict.failure_probability} level={predict.level} />
            <p style={{ color: 'var(--muted)', marginTop: 8 }}>{predict.basis} <i>(confidence: {predict.confidence})</i></p>
          </div>
        )}

        {plan && (
          <div style={{ marginBottom: 14 }}>
            <h4 style={{ margin: '6px 0' }}>Rollback plan — target {plan.rollback_target || 'none recorded'}</h4>
            <ol style={{ margin: '6px 0' }}>{plan.steps.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}</ol>
            {plan.narrative && <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--panel-2)', padding: 12, borderRadius: 8 }}>{plan.narrative}</pre>}
          </div>
        )}

        {notes && (
          <div>
            <h4 style={{ margin: '6px 0' }}>{notes.llm_used ? 'AI-polished release notes' : 'Generated release notes (no LLM key)'}</h4>
            <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--panel-2)', padding: 12, borderRadius: 8 }}>{notes.polished || notes.raw}</pre>
          </div>
        )}
      </Section>

      {/* ── PR intelligence ── */}
      <Section title="🔀 Pull request intelligence">
        <div className="inline-form" style={{ marginBottom: 12 }}>
          <select value={repoId} onChange={(e) => { setRepoId(e.target.value); setRisky(null); }}>
            <option value="">— select repository —</option>
            {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button disabled={!repoId || busy} onClick={() => run('risky', () => api.aiRiskyPrs(repoId), setRisky)}>Detect risky PRs</button>
          <input style={{ width: 90 }} placeholder="PR #" value={prNum} onChange={(e) => setPrNum(e.target.value)} />
          <button disabled={!repoId || !prNum || busy} onClick={() => run('rev', () => api.aiReviewers(repoId, prNum), setReviewers)}>Recommend reviewers</button>
          <button disabled={!repoId || !prNum || busy} onClick={() => run('brk', () => api.aiBreakingChanges(repoId, prNum), setBreaking)}>Detect breaking changes</button>
        </div>

        {risky && (
          <table className="grid" style={{ marginBottom: 12 }}>
            <thead><tr><th>PR</th><th>Risk</th><th>Churn</th><th>Files</th><th>Age</th><th>Why</th></tr></thead>
            <tbody>
              {risky.map((p) => (
                <tr key={p.number}>
                  <td><a href={p.url} target="_blank" rel="noreferrer">#{p.number}</a> {p.title}<div style={{ fontSize: 12, color: 'var(--muted)' }}>@{p.author}</div></td>
                  <td><span style={{ color: LV[p.level], fontWeight: 700 }}>{p.score} {p.level}</span></td>
                  <td>{p.churn}</td><td>{p.files}</td><td>{p.age_days}d</td>
                  <td style={{ fontSize: 12 }}>{p.reasons.join(', ') || '—'}</td>
                </tr>
              ))}
              {risky.length === 0 && <tr><td colSpan={6} className="empty">No open PRs.</td></tr>}
            </tbody>
          </table>
        )}

        {reviewers && (
          <div style={{ marginBottom: 12 }}>
            <h4 style={{ margin: '6px 0' }}>Recommended reviewers — PR #{reviewers.pr_number} ({reviewers.files_changed} files)</h4>
            {reviewers.reviewers.length === 0 ? <p className="empty">{reviewers.note}</p> : (
              <ul>{reviewers.reviewers.map((r) => <li key={r.login}><b>@{r.login}</b> — {r.reason}</li>)}</ul>
            )}
          </div>
        )}

        {breaking && (
          <div>
            <h4 style={{ margin: '6px 0' }}>Breaking-change scan — PR #{breaking.pr_number} <span style={{ color: LV[breaking.level] }}>({breaking.level})</span></h4>
            {breaking.flags.length === 0 ? <p className="empty">No breaking-change signals detected.</p> : (
              <ul>{breaking.flags.map((f, i) => <li key={i}><b>{f.kind}</b> — <code>{f.file}</code> <span style={{ color: 'var(--muted)' }}>({f.why})</span></li>)}</ul>
            )}
            {breaking.narrative && <p style={{ color: 'var(--muted)' }}>💬 {breaking.narrative}</p>}
          </div>
        )}
      </Section>

      {/* ── Incident analysis ── */}
      <Section title="🚨 Production incident analysis">
        <div className="inline-form" style={{ marginBottom: 12 }}>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {[24, 72, 168].map((h) => <option key={h} value={h}>last {h}h</option>)}
          </select>
          <button disabled={busy} onClick={() => run('inc', () => api.aiIncidents(hours), setIncidents)}>Analyze incidents</button>
        </div>
        {incidents && (
          <div>
            <p>
              <b>{incidents.total_alerts}</b> alerts in {incidents.window_hours}h · <b style={{ color: '#ef4444' }}>{incidents.high_critical}</b> high/critical ·
              {' '}<b>{incidents.suspected_release_linked.length}</b> suspected release-linked
            </p>
            {incidents.suspected_release_linked.length > 0 && (
              <table className="grid" style={{ marginBottom: 10 }}>
                <thead><tr><th>Alert</th><th>Severity</th><th>Server</th><th>Likely from deploy</th></tr></thead>
                <tbody>
                  {incidents.suspected_release_linked.map((s, i) => (
                    <tr key={i}>
                      <td>{s.alert.type} <span style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(s.alert.created_at).toLocaleString()}</span></td>
                      <td>{s.alert.severity}</td>
                      <td>{s.alert.server_name || '—'}</td>
                      <td>{s.deploy.version} → {s.deploy.channel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {incidents.narrative && <p style={{ color: 'var(--muted)' }}>💬 {incidents.narrative}</p>}
          </div>
        )}
      </Section>
    </div>
  );
}
