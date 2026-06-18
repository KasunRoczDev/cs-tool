const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageNumber, Header, Footer, TableOfContents, LevelFormat,
} = require('docx');

const CONTENT_W = 9360;
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 110, right: 110 };

function h1(t) { return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] }); }
function h2(t) { return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] }); }
function p(t) { return new Paragraph({ spacing: { after: 120 }, children: [new TextRun(t)] }); }
function bullet(t) { return new Paragraph({ numbering: { reference: "b", level: 0 }, children: [new TextRun(t)] }); }

function th(text, w) {
  return new TableCell({ borders, width: { size: w, type: WidthType.DXA }, margins: cellMargins,
    shading: { fill: "1F3864", type: ShadingType.CLEAR },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 18 })] })] });
}
function td(text, w, fill) {
  return new TableCell({ borders, width: { size: w, type: WidthType.DXA }, margins: cellMargins,
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: String(text), size: 18 })] })] });
}
function table(headers, rows, widths) {
  const headerRow = new TableRow({ tableHeader: true, children: headers.map((hd, i) => th(hd, widths[i])) });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((c, i) => td(c, widths[i], ri % 2 ? "F2F5FA" : undefined)),
  }));
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths,
    rows: [headerRow, ...bodyRows] });
}
function spacer() { return new Paragraph({ spacing: { after: 120 }, children: [] }); }

const children = [];

// Title
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 80 },
  children: [new TextRun({ text: "Monitoring & Security Reference", bold: true, size: 48, color: "1F3864" })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 },
  children: [new TextRun({ text: "DevOps / DevSecOps Metrics, Risks & Alert Thresholds", size: 26, color: "555555" })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 },
  children: [new TextRun({ text: "Cybersecurity & Server Metrics Monitoring Platform  ·  June 2026", size: 20, color: "888888" })] }));
children.push(new Paragraph({ pageBreakBefore: true, children: [new TextRun({ text: "Contents", bold: true, size: 28 })] }));
children.push(new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }));

// 1. How to read
children.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun("1. How to use this reference")] }));
children.push(p("This document is the complete checklist of what to monitor across three layers — server health, security, and application — with concrete alert thresholds. It pairs with the monitoring/ add-on folder in this repository, which implements the gaps your platform did not previously cover. Rows flagged NEW are the additions; the rest your agent already collects."));
children.push(p("Severity convention used throughout: critical = page immediately; high = investigate within the hour; medium = review same day; low = informational / trend only."));

// 2. Server
children.push(h1("2. Core server parameters (system health)"));
children.push(h2("2.1 CPU & load"));
children.push(table(
  ["Metric", "Why it matters / risk", "Threshold", "Status"],
  [
    ["CPU usage % (user/sys/iowait)", "Exhaustion → DDoS, infinite loop, bad deploy", "warn 80%, crit 90% sustained 5m", "Have"],
    ["Load average 1/5/15", "Trend before crash; 5/15 show direction", "see load_per_core", "5/15 NEW"],
    ["Load per core (load1 ÷ cores)", ">1 = demand exceeds CPUs", "warn 1.5, crit 3.0", "NEW"],
    ["iowait %", "High iowait = disk is the bottleneck, not CPU", "warn 20%", "via CPU"],
  ], [2700, 3700, 2160, 800]));
children.push(spacer());
children.push(h2("2.2 Memory"));
children.push(table(
  ["Metric", "Why it matters / risk", "Threshold", "Status"],
  [
    ["Used / available memory %", "Leak (Node/PHP-FPM) → crashes", "warn 85%, crit 95%", "Have"],
    ["Swap usage %", "Swap thrashing = severe latency before OOM", "warn 25%, crit 50%", "NEW"],
    ["OOM-killer events", "Kernel killed a process — silent outage", "any event = high", "via auditd"],
  ], [2700, 3700, 2160, 800]));
children.push(spacer());
children.push(h2("2.3 Disk"));
children.push(table(
  ["Metric", "Why it matters / risk", "Threshold", "Status"],
  [
    ["Disk usage %", "Full disk → DB crash, log loss", "warn 80%, crit 90%", "Have"],
    ["Inode usage %", "Out of inodes = can't create files (disk looks empty)", "warn 80%, crit 90%", "NEW"],
    ["Disk read/write B/s", "Saturation → DB + API latency", "baseline + trend", "NEW"],
    ["I/O queue depth", "Sustained queue = slow disk", "warn 8, crit 20", "NEW"],
  ], [2700, 3700, 2160, 800]));
children.push(spacer());
children.push(h2("2.4 Network & connections"));
children.push(table(
  ["Metric", "Why it matters / risk", "Threshold", "Status"],
  [
    ["In/out bytes per sec", "DDoS, exfil, saturation", "baseline + spike", "Have"],
    ["TCP ESTABLISHED", "Connection load", "baseline", "NEW"],
    ["TCP TIME_WAIT", "Pileup exhausts ephemeral ports", "warn 20k, crit 40k", "NEW"],
    ["TCP SYN_RECV", "Sustained high = SYN flood", "warn 256, crit 1024", "NEW"],
    ["conntrack table %", "Table full → silently dropped connections", "warn 70%, crit 85%", "NEW"],
    ["File descriptors %", "High-connection servers die here first", "warn 70%, crit 85%", "NEW"],
  ], [2700, 3700, 2160, 800]));
children.push(spacer());
children.push(h2("2.5 Process & host integrity"));
children.push(table(
  ["Metric", "Why it matters / risk", "Threshold", "Status"],
  [
    ["Total / running processes", "Fork bomb, runaway spawning", "baseline + spike", "NEW"],
    ["Zombie processes", "Defunct children pile up", "warn 20, crit 100", "NEW"],
    ["Uptime", "Unexpected reboot = crash or attack", "drop = investigate", "NEW"],
    ["NTP / time drift", "Breaks TLS, auth, log correlation", "warn 500ms, crit 2s", "NEW"],
  ], [2700, 3700, 2160, 800]));

// 3. Security
children.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun("3. Security monitoring (DevSec)")] }));
children.push(h2("3.1 Authentication & access"));
children.push(table(
  ["Signal", "Risk", "Threshold / action", "Status"],
  [
    ["SSH failed logins", "Brute force, credential stuffing", "warn 20/min, crit 100/min", "Have"],
    ["Root login attempts", "Direct privileged compromise", "any = high; disable root SSH", "Have"],
    ["sudo / su usage & failures", "Privilege escalation", "failures = high", "Have"],
    ["GeoIP / impossible travel", "Stolen creds from new country", "new country = review", "Gap*"],
    ["PermitRootLogin / PasswordAuth", "Weak SSH config", "flag if enabled", "NEW"],
  ], [2700, 3300, 2560, 800]));
children.push(spacer());
children.push(h2("3.2 Network & firewall"));
children.push(table(
  ["Signal", "Risk", "Threshold / action", "Status"],
  [
    ["UFW / iptables blocks", "Lateral movement, scanning", "spike = medium", "Have"],
    ["Firewall inactive / permissive", "No perimeter", "critical", "Have"],
    ["Open dangerous ports (DB/Redis)", "Exposed data services", "any exposed = high", "Have"],
    ["Outbound traffic anomaly", "Malware C2, exfiltration", "Falco rule + baseline", "NEW (Falco)"],
    ["Network IDS (Suricata/Zeek)", "Packet-level intrusion", "deploy Suricata", "Gap*"],
  ], [2700, 3300, 2560, 800]));
children.push(spacer());
children.push(h2("3.3 OS, process & file integrity"));
children.push(table(
  ["Signal", "Risk", "Tool", "Status"],
  [
    ["New root process / suspicious exec", "Backdoor, cryptominer", "auditd + Falco", "Have/NEW"],
    ["Binaries dropped in /tmp /dev/shm", "Dropper, miner", "Falco rule", "NEW"],
    ["Shell spawned in container", "Post-exploitation", "Falco rule", "NEW"],
    ["Changes to /etc/passwd,/shadow,sudoers", "Privilege escalation, backdoor acct", "auditd rules", "NEW"],
    ["cron / systemd unit changes", "Persistence", "auditd rules", "NEW"],
    ["app .env / SSH key reads", "Credential theft", "Falco + auditd", "NEW"],
    ["Kernel module load", "Rootkit", "auditd", "NEW"],
  ], [2900, 3100, 2560, 800]));
children.push(spacer());
children.push(h2("3.4 Vulnerability & supply chain"));
children.push(table(
  ["Signal", "Risk", "Tool", "Status"],
  [
    ["TLS certificate expiry", "Outage — very common", "cert-cve.js / check-tls script", "NEW"],
    ["Container image CVEs", "Shipping known-vuln images", "Trivy in CI", "NEW"],
    ["Dependency CVEs (npm audit)", "Vulnerable libraries", "cert-cve.js / Trivy fs", "NEW"],
    ["Pending OS security updates", "Unpatched CVE exposure", "cert-cve.js / unattended-upgrades", "NEW"],
    ["Secrets in commits", "Leaked keys/.env", "gitleaks in CI", "NEW"],
    ["Host hardening drift", "Misconfiguration", "Lynis audit", "NEW"],
  ], [2900, 3100, 2560, 800]));
children.push(spacer());
children.push(h2("3.5 Logs to monitor & protect"));
children.push(bullet("/var/log/auth.log, /var/log/syslog, kern.log — auth, sudo, kernel events."));
children.push(bullet("nginx/apache access + error logs — exploit probes, scanners, 5xx."));
children.push(bullet("/var/log/audit/audit.log — auditd integrity events."));
children.push(bullet("Application logs (NestJS, OMS, courier, IoT) — errors and anomalies."));
children.push(bullet("Critical: ship logs OFF-HOST so an attacker who roots the box cannot wipe the evidence."));

// 4. Application
children.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun("4. Application-level metrics")] }));
children.push(h2("4.1 API layer"));
children.push(table(
  ["Metric", "Risk", "Threshold", "Status"],
  [
    ["Request rate (RPS)", "Bot attack, retry storm", "baseline + spike", "Partial"],
    ["Error rate 4xx / 5xx", "Broken deploy, hidden DB issue", "warn 1%, crit 5% 5xx", "Partial"],
    ["Latency p95 / p99", "Slow API = hidden bottleneck", "p95 < 300ms (SLO)", "Partial"],
    ["Distributed tracing", "Can't see where time goes across services", "OpenTelemetry", "NEW"],
    ["Synthetic / uptime probe", "Internal metrics can't confirm 'actually up'", "blackbox_exporter", "NEW"],
  ], [2700, 3300, 2560, 800]));
children.push(spacer());
children.push(h2("4.2 Queue (BullMQ / Redis)"));
children.push(table(
  ["Metric", "Risk", "Threshold", "Status"],
  [
    ["Waiting (backlog)", "Backlog explosion, silent delay", "warn 1000", "NEW"],
    ["Active = 0 with backlog", "Stuck worker", "any = high", "NEW"],
    ["Failed jobs / DLQ", "Lost work after retries", "rate > 1%", "NEW"],
  ], [2700, 3300, 2560, 800]));
children.push(spacer());
children.push(h2("4.3 Database (PostgreSQL / TimescaleDB)"));
children.push(table(
  ["Metric", "Risk", "Threshold", "Status"],
  [
    ["Connection usage %", "Connection exhaustion", "warn 75%, crit 90%", "NEW"],
    ["Idle-in-transaction", "Leaked transactions, lock holds", "trend up = investigate", "NEW"],
    ["Blocked locks / deadlocks", "Contention, stalls", "any = review", "NEW"],
    ["Long-running queries (>5s)", "Query bottleneck", "any = review", "NEW"],
    ["Replication lag", "Stale reads, failover risk", "warn 30s, crit 120s", "NEW"],
  ], [2700, 3300, 2560, 800]));
children.push(spacer());
children.push(h2("4.4 Cache (Redis)"));
children.push(table(
  ["Metric", "Risk", "Threshold", "Status"],
  [
    ["Hit / miss ratio", "Cache too small/cold → DB load", "warn < 0.8, crit < 0.5", "NEW"],
    ["Used memory", "Memory pressure", "vs maxmemory", "NEW"],
    ["Evicted keys", "Under memory pressure", "> 0 trending = warn", "NEW"],
  ], [2700, 3300, 2560, 800]));

// 5. Critical alerts
children.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun("5. High-value attack signals (must-page)")] }));
children.push(bullet("100+ failed SSH logins per minute (brute force)."));
children.push(bullet("Sudden outbound traffic spike from a server process (C2 / exfiltration)."));
children.push(bullet("New process running as root / shell spawned in container."));
children.push(bullet("Unexpected new listening port or exposed DB/Redis port."));
children.push(bullet("Disk or inode > 90%; CPU > 90% sustained; swap > 50%."));
children.push(bullet("conntrack or file-descriptors > 85% (silent connection drops)."));
children.push(bullet("New/modified cronjob or systemd unit (persistence)."));
children.push(bullet("TLS certificate expiring in < 7 days, or already expired."));
children.push(bullet("Critical CVE in a deployed image or dependency."));
children.push(bullet("Changes to /etc/passwd, /etc/shadow, or sudoers."));

// 6. Tooling map
children.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun("6. Tooling map")] }));
children.push(table(
  ["Tool", "Purpose", "Where in repo"],
  [
    ["Your agent + TimescaleDB", "Core metrics + security events", "agent/, backend/, database/"],
    ["metrics-extended.js", "Swap, inode, I/O, conntrack, FD, TCP, procs, drift", "agent/src/collectors/"],
    ["cert-cve.js", "TLS expiry, dep/OS CVEs", "agent/src/collectors/"],
    ["Falco", "Runtime/syscall + container threats", "monitoring/security-tools/falco/"],
    ["Fail2Ban", "Active brute-force blocking", "monitoring/security-tools/fail2ban/"],
    ["auditd", "OS-level audit events", "monitoring/security-tools/auditd/"],
    ["Trivy", "Image + filesystem CVE/secret scan", "monitoring/security-tools/scan/"],
    ["gitleaks", "Secret scanning in CI", "monitoring/security-tools/ci/"],
    ["Lynis", "Host hardening audit", "run: lynis audit system"],
    ["OpenTelemetry", "Distributed tracing", "monitoring/app-instrumentation/"],
    ["Prometheus/Grafana/Tempo", "Optional sidecar (exporters, blackbox, traces)", "monitoring/app-instrumentation/"],
  ], [2400, 4200, 2760]));
children.push(spacer());
children.push(p("* Items marked Gap are recommended next steps not yet implemented in this repo: GeoIP/impossible-travel detection on auth events, and a network IDS (Suricata or Zeek) for packet-level intrusion detection. Also worth adding operationally: verified, restore-tested backups and an incident-response runbook with on-call rotation."));

const doc = new Document({
  numbering: { config: [{ reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 260 } } } }] }] },
  styles: {
    default: { document: { run: { font: "Arial", size: 21 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: "Arial", color: "1F3864" },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: "2E5496" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Monitoring & Security Reference  ·  Page ", size: 16, color: "888888" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888" })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(process.argv[2], buf);
  console.log("written", process.argv[2]);
});
