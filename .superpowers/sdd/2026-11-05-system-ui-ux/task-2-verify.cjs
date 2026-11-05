const fs = require('fs');
const assert = require('node:assert/strict');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('node:child_process');
const root = process.cwd();
const sourceRef = process.env.TASK2_SOURCE_REF || 'HEAD';
const readSource = file => execFileSync('git', ['show', `${sourceRef === 'INDEX' ? '' : sourceRef}:${file}`], { cwd: root, encoding: 'utf8' });
const dashboard = path.join(root, 'dashboard');
const { transform } = require(path.join(dashboard, 'node_modules/next/dist/build/swc'));
const jsx = require(path.join(dashboard, 'node_modules/react/jsx-runtime'));
async function compile(file, imports) {
  const source = readSource(path.relative(root, file).replaceAll('\\', '/'));
  const result = await transform(source, { filename: file, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' } });
  const module = { exports: {} };
  vm.runInNewContext(result.code, { module, exports: module.exports, require(name) { if (name === 'react/jsx-runtime') return jsx; if (name in imports) return imports[name]; throw Error('Unexpected import ' + name); }, localStorage: { getItem() { return null; }, setItem() {} }, window: { addEventListener() {}, removeEventListener() {} }, document: { body: { style: {} } }, console });
  return module.exports.default;
}
function all(node) { if (!node || typeof node !== 'object') return []; return [node, ...[node.props?.children].flat(Infinity).flatMap(all)]; }
(async () => {
  let state, index, pathname = '/', effects;
  const hooks = { useState(initial) { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; }, useRef(value) { return { current: value }; }, useEffect(fn) { effects.push(fn); } };
  const iconPath = path.join(dashboard, 'components/Icon.jsx');
  const Icon = fs.existsSync(iconPath) ? await compile(iconPath, {}) : () => null;
  const Shell = await compile(path.join(dashboard, 'components/Shell.jsx'), { react: hooks, 'next/link': 'a', 'next/navigation': { useRouter: () => ({ replace() {}, push() {} }), usePathname: () => pathname }, '@/lib/api': { api: {}, getToken: () => 'token', getRole: () => 'admin', setRole() {}, setToken() {} }, '@/lib/socket': { getSocket: () => null }, './Icon': Icon });
  function render(route, role = 'admin', reset = true) { pathname = route; if (reset) state = [true, role, 3, true, false]; index = 0; effects = []; return all(Shell({ children: 'Content' })); }
  let cases = 0;
  for (const [route, expected] of [['/', '/'], ['/products/42', '/products'], ['/releases/42', '/releases'], ['/alerts/history', '/alerts'], ['/products-other', null]]) {
    const nodes = render(route);
    assert.deepEqual(nodes.filter(n => n.props?.['aria-current'] === 'page').map(n => n.props.href), expected ? [expected] : []);
    cases++;
  }
  for (const role of ['admin', 'operator', 'viewer']) {
    const nodes = render('/', role);
    const links = nodes.filter(n => n.type === 'a');
    for (const href of ['/release-workflows', '/audit-log', '/agent-updates', '/users', '/access']) assert.equal(links.some(n => n.props.href === href), role === 'admin');
    assert.ok(links.some(n => n.props.href === '/billing/import'));
    cases++;
  }
  let nodes = render('/alerts');
  assert.ok(nodes.some(n => n.props?.className === 'badge' && [n.props.children].flat().includes(3)));
  const toggle = nodes.find(n => n.props?.['aria-controls'] === 'primary-navigation');
  assert.ok(toggle?.props['aria-label']);
  assert.equal(toggle.props['aria-expanded'], false);
  toggle.props.onClick();
  nodes = render('/alerts', 'admin', false);
  assert.equal(nodes.find(n => n.props?.['aria-controls'] === 'primary-navigation').props['aria-expanded'], true);
  const backdrop = nodes.find(n => n.props?.className?.includes('mobile-nav-backdrop'));
  assert.ok(backdrop?.props['aria-label']);
  backdrop.props.onClick();
  nodes = render('/alerts', 'admin', false);
  assert.equal(nodes.find(n => n.props?.['aria-controls'] === 'primary-navigation').props['aria-expanded'], false);
  cases++;
  nodes.find(n => n.props?.['aria-controls'] === 'primary-navigation').props.onClick();
  nodes = render('/alerts', 'admin', false);
  nodes.find(n => n.type === 'a' && n.props.href === '/products').props.onClick();
  nodes = render('/alerts', 'admin', false);
  assert.equal(nodes.find(n => n.props?.['aria-controls'] === 'primary-navigation').props['aria-expanded'], false);
  cases++;
  const svg = Icon({ name: 'overview', size: 20 });
  assert.equal(svg.type, 'svg'); assert.equal(svg.props['aria-hidden'], 'true'); assert.equal(svg.props.focusable, 'false'); assert.equal(svg.props.width, 20);
  cases++;
  const shellSource = readSource('dashboard/components/Shell.jsx');
  const cssSource = readSource('dashboard/app/globals.css');
  for (const name of ['passkey-nudge', 'passkey-nudge-actions', 'passkey-nudge-link']) {
    assert.ok(cssSource.includes(`.shell-layout .${name} {`), `${name} is defined in globals.css`);
    assert.ok(!shellSource.includes(`.shell-layout .${name} {`), `${name} is not defined in Shell`);
  }
  cases++;
  console.log(`Source: ${sourceRef} (Git object contents, not working-tree source files).`);
  console.log(`PASS: ${cases} behavior cases (routes, roles, badge, mobile toggle/backdrop/link dismissal, decorative SVG, globals.css nudge styles).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
