const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');
const sourceRef = process.env.TASK2_SOURCE_REF || 'HEAD';
const readSource = file => execFileSync('git', ['show', `${sourceRef === 'INDEX' ? '' : sourceRef}:${file}`], { encoding: 'utf8' });
const { transform } = require(path.resolve('dashboard/node_modules/next/dist/build/swc'));
(async () => {
 const dir = path.resolve('.superpowers/sdd/2026-11-05-system-ui-ux');
 const compile = async name => (await transform(readSource('dashboard/components/' + name + '.jsx'), { filename: name + '.jsx', jsc: { parser: { syntax: 'ecmascript', jsx:true }, transform: { react:{ runtime:'classic' } }, target:'es2020' }, module:{ type:'commonjs' } })).code;
 const icon = await compile('Icon');
 const shell = await compile('Shell');
 const react = fs.readFileSync('dashboard/node_modules/react/umd/react.development.js','utf8');
 const dom = fs.readFileSync('dashboard/node_modules/react-dom/umd/react-dom.development.js','utf8');
 const css = readSource('dashboard/app/globals.css');
 const boot = `
 (()=>{
 localStorage.removeItem('passkeyNudgeDismissed'); document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark';
 let route='/products/42'; const listeners=new Set();
 const navigation={ useRouter:()=>({replace(){},push(){}}), usePathname:()=>{const [value,setValue]=React.useState(route); React.useEffect(()=>{listeners.add(setValue); return ()=>listeners.delete(setValue)},[]); return value;} };
 const go=value=>{route=value;listeners.forEach(fn=>fn(value));};
 const imports={react:React,'next/navigation':navigation,'next/link':({href,onClick,children,...props})=>React.createElement('a',{...props,href,onClick:event=>{event.preventDefault();onClick?.(event);go(href);}},children),'@/lib/api':{api:{myPasskeys:()=>Promise.resolve([])},getToken:()=> 'test',getRole:()=> 'admin',setRole(){},setToken(){}},'@/lib/socket':{getSocket:()=>null}};
 function require(name){return imports[name];}
 let module={exports:{}}; let exports=module.exports;
 ${icon}
 imports['./Icon']=module.exports.default; module={exports:{}}; exports=module.exports;
 ${shell}
 const AppShell=module.exports.default;
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppShell,null,React.createElement('h1',null,'Shared shell review')));
 const wait=()=>new Promise(r=>setTimeout(r,100));
 (async()=>{await wait();await wait();const result=[]; const check=(ok,label)=>{if(!ok)throw Error(label);result.push(label)};
 const toggle=document.querySelector('.mobile-nav-toggle'); const sidebar=document.querySelector('.sidebar');
 if(window.innerWidth>760){check(getComputedStyle(sidebar).position==='sticky','Desktop sidebar sticky');check(sidebar.getBoundingClientRect().width===232,'Desktop sidebar 232px');check(getComputedStyle(toggle).display==='none','Mobile toggle hidden');check(document.querySelector('.passkey-nudge').textContent.includes('Set up a passkey for faster, more secure sign-in.'),'Passkey copy preserved');check(document.documentElement.scrollWidth<=window.innerWidth,'No desktop overflow');document.getElementById('result').textContent='PASS '+result.length+': '+result.join('; ');return;}
 check(document.querySelector('[aria-current="page"]').getAttribute('href')==='/products','Nested route active');
 check(getComputedStyle(sidebar).visibility==='hidden','Mobile panel hidden');
 check(getComputedStyle(toggle).display!=='none','Mobile toggle visible');
 toggle.click();await wait();
 check(toggle.getAttribute('aria-expanded')==='true','Toggle opens');
 check(getComputedStyle(sidebar).visibility==='visible','Mobile panel visible');
 check(sidebar.contains(document.activeElement),'Focus enters panel');
 const controls=sidebar.querySelectorAll('a[href], button'); controls[controls.length-1].focus();
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
 check(document.activeElement===controls[0],'Tab wraps forward');
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
 check(document.activeElement===controls[controls.length-1],'Tab wraps backward');
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait();
 check(toggle.getAttribute('aria-expanded')==='false' && document.activeElement===toggle,'Escape closes and restores focus');
 check(document.body.style.overflow==='','Scroll restored');
 toggle.click();await wait();document.querySelector('.mobile-nav-backdrop').click();await wait();
 check(toggle.getAttribute('aria-expanded')==='false','Backdrop closes');
 toggle.click();await wait();sidebar.querySelector('a[href="/releases"]').click();await wait();
 check(toggle.getAttribute('aria-expanded')==='false' && document.querySelector('[aria-current="page"]').getAttribute('href')==='/releases','Navigation closes and updates route');
 go('/profile');await wait();check(!document.querySelector('.passkey-nudge'),'Profile hides nudge');
 go('/products');await wait(); document.querySelector('.passkey-nudge button').click();await wait();
 check(!document.querySelector('.passkey-nudge') && localStorage.getItem('passkeyNudgeDismissed')==='1','Nudge dismissal persisted');
 check(document.documentElement.scrollWidth<=window.innerWidth,'No horizontal overflow');
 toggle.click();await wait();document.getElementById('result').textContent='PASS '+result.length+': '+result.join('; ');
 })().catch(e=>{document.getElementById('result').textContent='FAIL: '+e.message});
 })();
 `;
 fs.writeFileSync(path.join(dir,'task-2-browser.html'),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><pre id="result" style="position:absolute;left:300px;top:0;font-size:8px;max-width:70px;overflow:hidden"></pre><script>${react}</script><script>${dom}</script><script>${boot}</script></body></html>`);
 console.log(`Browser fixture source: ${sourceRef} (Git objects); React 18; API/router/socket stubbed.`);
})().catch(e=>{console.error(e);process.exitCode=1});
