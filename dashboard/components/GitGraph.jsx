'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Git commit-graph visualizer for a repository.
 *
 * Renders a branch dropdown and an SVG commit graph (nodes + parent edges,
 * like `git log --graph`). Commits come from the backend GitHub integration:
 * each has { sha, parents[], author, date, message }. Lanes are assigned with
 * a simple left-packing algorithm so merges/branches fan out visually.
 */

const LANE_COLORS = [
  '#4f9dff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
];

const ROW_H = 44;
const LANE_W = 22;
const LEFT_PAD = 18;
const DOT_R = 6;

// Assign each commit a lane. Commits arrive newest-first (topological-ish from
// the GitHub API). We walk top→bottom, reserving a lane per "active branch tip"
// and reusing the first parent's lane to keep mainline straight.
function layout(commits) {
  const indexBySha = new Map(commits.map((c, i) => [c.sha, i]));
  const lanes = []; // lanes[laneIndex] = sha currently expected in that lane
  const rows = [];
  let maxLane = 0;

  const claimLane = (sha) => {
    let l = lanes.indexOf(sha);
    if (l === -1) {
      l = lanes.indexOf(null);
      if (l === -1) {
        l = lanes.length;
        lanes.push(sha);
      } else {
        lanes[l] = sha;
      }
    }
    return l;
  };

  commits.forEach((c) => {
    const lane = claimLane(c.sha);
    lanes[lane] = null; // free this slot; reassign to parents below
    maxLane = Math.max(maxLane, lane);

    const parentLanes = [];
    c.parents.forEach((p, pi) => {
      // Only draw edges to parents that are part of this fetched window.
      if (!indexBySha.has(p)) return;
      let pl;
      if (pi === 0 && lanes[lane] === null) {
        lanes[lane] = p; // first parent continues this commit's lane
        pl = lane;
      } else {
        pl = claimLane(p);
      }
      maxLane = Math.max(maxLane, pl);
      parentLanes.push({ sha: p, lane: pl });
    });

    rows.push({ commit: c, lane, parentLanes });
  });

  return { rows, laneCount: maxLane + 1 };
}

export default function GitGraph({ repo, onClose }) {
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState(repo.default_branch || 'main');
  const [commits, setCommits] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  // Load branches once.
  useEffect(() => {
    let alive = true;
    api.repoBranches(repo.id)
      .then((bs) => {
        if (!alive) return;
        setBranches(bs);
        // Prefer the default branch if present, else the first one.
        const names = bs.map((b) => b.name);
        if (!names.includes(branch) && names.length) setBranch(names[0]);
      })
      .catch((e) => setErr(e.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.id]);

  // Load commits whenever the branch changes.
  useEffect(() => {
    if (!branch) return;
    let alive = true;
    setLoading(true); setErr('');
    api.repoCommits(repo.id, branch, 60)
      .then((cs) => { if (alive) setCommits(cs); })
      .catch((e) => { if (alive) { setErr(e.message); setCommits([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [repo.id, branch]);

  const { rows, laneCount } = useMemo(() => layout(commits), [commits]);
  const graphW = LEFT_PAD + laneCount * LANE_W + 10;
  const svgH = Math.max(rows.length * ROW_H, ROW_H);
  const laneX = (l) => LEFT_PAD + l * LANE_W;
  const rowY = (i) => i * ROW_H + ROW_H / 2;
  const idx = useMemo(
    () => new Map(commits.map((c, i) => [c.sha, i])),
    [commits],
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
    }} onClick={onClose}>
      <div className="card" style={{
        width: 'min(900px, 94vw)', maxHeight: '88vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', padding: 0,
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
          borderBottom: '1px solid var(--border,#2a2f3a)',
        }}>
          <h3 style={{ margin: 0 }}>🌿 {repo.name}</h3>
          <select value={branch} onChange={(e) => setBranch(e.target.value)}>
            {branches.length === 0 && <option value={branch}>{branch}</option>}
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}{b.protected ? ' 🔒' : ''}
              </option>
            ))}
          </select>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
            {loading ? 'loading…' : `${commits.length} commits`}
          </span>
          <button style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>

        {err && <div className="error" style={{ margin: 14 }}>{err}</div>}

        <div style={{ overflow: 'auto', display: 'flex' }}>
          <svg width={graphW} height={svgH} style={{ flex: '0 0 auto' }}>
            {/* edges */}
            {rows.map((r, i) =>
              r.parentLanes.map((p) => {
                const pIndex = idx.get(p.sha);
                if (pIndex === undefined) return null;
                const x1 = laneX(r.lane), y1 = rowY(i);
                const x2 = laneX(p.lane), y2 = rowY(pIndex);
                const color = LANE_COLORS[p.lane % LANE_COLORS.length];
                const midY = (y1 + y2) / 2;
                const d = x1 === x2
                  ? `M ${x1} ${y1} L ${x2} ${y2}`
                  : `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
                return (
                  <path key={`${r.commit.sha}-${p.sha}`} d={d} stroke={color}
                    strokeWidth="2" fill="none" />
                );
              }),
            )}
            {/* nodes */}
            {rows.map((r, i) => {
              const cx = laneX(r.lane), cy = rowY(i);
              const color = LANE_COLORS[r.lane % LANE_COLORS.length];
              const isMerge = r.commit.parents.length > 1;
              return (
                <circle key={r.commit.sha} cx={cx} cy={cy} r={DOT_R}
                  fill={isMerge ? 'var(--panel,#0b0e14)' : color}
                  stroke={color} strokeWidth="2.5">
                  <title>{r.commit.sha.slice(0, 8)} — {r.commit.message}</title>
                </circle>
              );
            })}
          </svg>

          {/* commit detail column */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {rows.map((r) => (
              <div key={r.commit.sha} style={{
                height: ROW_H, display: 'flex', flexDirection: 'column',
                justifyContent: 'center', padding: '0 14px',
                borderBottom: '1px solid var(--border,#1c2029)',
                overflow: 'hidden',
              }}>
                <div style={{
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  fontSize: 13,
                }}>
                  {r.commit.parents.length > 1 && <span title="merge">⛙ </span>}
                  {r.commit.message}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  <code>{r.commit.sha.slice(0, 8)}</code>
                  {' · '}{r.commit.author}
                  {r.commit.date && ` · ${new Date(r.commit.date).toLocaleString()}`}
                </div>
              </div>
            ))}
            {rows.length === 0 && !loading && (
              <div className="empty" style={{ padding: 18 }}>No commits to show.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
