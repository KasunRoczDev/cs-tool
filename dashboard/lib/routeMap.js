// Request-URL labelling for a multi-site host.
// ---------------------------------------------------------------------------
// This box fronts many sites (GCEC, OMS Live, Parallax QA, Transexpress, ...).
// The SOURCE OF TRUTH for a request URL is nginx, which knows both the real URL
// and which vhost ($host) served it. So by DEFAULT we show the real nginx URL
// (with volatile ids masked) — no per-app assumptions, correct for every site.
//
// Path-routed apps (e.g. /order/list) therefore display their real routes with
// zero config. Only legacy front-controller sites that funnel everything through
// /index.php?params need help — and ONLY for those do you add per-host rules
// below. Nothing here changes the apps; it is display logic in the dashboard.
//
// HOW TO EDIT: add an entry to HOST_RULES keyed by the exact nginx $host. Each
// rule is tried top-to-bottom, first match wins. `params` lists the param keys
// that must be present; `route` is a string or (params) => string. Hosts with no
// entry just show their real nginx URL.

export const HOST_RULES = {
  // Example for a legacy front-controller site — RENAME the host and fix the
  // routes to match that app. Delete this block if you have no such site.
  // 'oms.example.com': [
  //   { params: ['dataKey'],                 route: (p) => p.dataKey.replace(/_/g, '/') },
  //   { params: ['waybill_id'],              route: 'waybill/track' },
  //   { params: ['reason_type_id'],          route: 'reasons/list' },
  //   { params: ['current_page', 'per_page'], route: 'orders/list' },
  //   { params: ['action'],                  route: (p) => 'orders/' + p.action },
  // ],
};

// Values that look like volatile ids are masked so the same route groups together.
function isVolatile(v) {
  return /^\d+$/.test(v) || /^[A-Za-z]{1,4}\d{3,}$/.test(v) || (v || '').length > 24;
}

function parseParams(qs) {
  const out = {};
  if (!qs) return out;
  for (const kv of qs.split('&')) {
    const eq = kv.indexOf('=');
    if (eq === -1) { out[kv] = ''; continue; }
    out[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  return out;
}

// The real nginx URL with param values masked. This is the default label.
function maskedUrl(base, params) {
  const keys = Object.keys(params);
  if (keys.length === 0) return base;
  const parts = keys.map((k) => {
    const v = params[k];
    return v === '' ? k : k + '=' + (isVolatile(v) ? '*' : v);
  });
  return base + '?' + parts.join('&');
}

// Resolve a request label. host = nginx $host (which site). path = "/x?a=b".
// body = raw POST body or null. Default: the real nginx URL, masked. Per-host
// rules only kick in for front-controller sites you configured.
export function resolveRoute(method, path, body, host) {
  const qi = (path || '').indexOf('?');
  const base = qi === -1 ? (path || '') : path.slice(0, qi);
  const query = qi === -1 ? '' : path.slice(qi + 1);
  const params = parseParams(query);
  if ((method || '').toUpperCase() === 'POST' && body) {
    Object.assign(params, parseParams(body));
  }

  const rules = HOST_RULES[host];
  const isFrontController = /\/index\.php$/.test(base) || base === '/' || base === '';
  if (rules && isFrontController) {
    for (const rule of rules) {
      if (rule.params.every((k) => k in params)) {
        const r = typeof rule.route === 'function' ? rule.route(params) : rule.route;
        if (r) return r;
      }
    }
  }
  // Default for every site: the real URL nginx saw.
  return maskedUrl(base, params);
}
