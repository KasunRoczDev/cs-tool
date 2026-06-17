import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

// ── Types ─────────────────────────────────────────────────────────────────

export type FindingCategory = 'authentication' | 'webserver' | 'firewall' | 'system' | 'exposure';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface Evidence {
  label: string;
  value: string | number;
}

export interface RemediationStep {
  step: string;
  command?: string;
}

export interface Finding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence: Evidence[];
  remediation: RemediationStep[];
  first_seen?: string;
  last_seen?: string;
  count: number;
}

export interface FindingCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface ServerPosture {
  server_id: string;
  server_name: string;
  score: number;
  grade: string;
  finding_counts: FindingCounts;
  findings: Finding[];
  generated_at: string;
}

const SEV_ORDER: FindingSeverity[] = ['critical', 'high', 'medium', 'low'];

// ── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class AnalysisService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Analyse a single server and return its security posture. */
  async analyzeServer(serverId: string, windowHours = 24): Promise<ServerPosture> {
    const { rows: srvRows } = await this.pool.query(
      'SELECT id, name FROM servers WHERE id = $1',
      [serverId],
    );
    if (!srvRows[0]) throw new Error(`Server ${serverId} not found`);
    const serverName = srvRows[0].name as string;

    const findings: Finding[] = [];
    const run = async (fn: (id: string, w: number) => Promise<Finding[]>) => {
      try { findings.push(...(await fn.call(this, serverId, windowHours))); }
      catch { /* individual check failure must not abort the rest */ }
    };

    await run(this.analyzeSshBruteForce);
    await run(this.analyzeCredentialStuffing);
    await run(this.analyzeNginxAttacks);
    await run(this.analyzeFirewallStatus);
    await run(this.analyzeFirewallBlockPatterns);
    await run(this.analyzeMalware);
    await run(this.analyzeSuspiciousProcesses);
    await run(this.analyzeFileIntegrity);
    await run(this.analyzePrivilegeEscalation);
    await run(this.analyzeOpenPorts);
    await run(this.analyzeDataExfiltration);
    await run(this.analyzeHighResourceUsage);

    findings.sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));

    const score = this.computeScore(findings);
    return {
      server_id: serverId,
      server_name: serverName,
      score,
      grade: this.grade(score),
      finding_counts: {
        critical: findings.filter((f) => f.severity === 'critical').length,
        high: findings.filter((f) => f.severity === 'high').length,
        medium: findings.filter((f) => f.severity === 'medium').length,
        low: findings.filter((f) => f.severity === 'low').length,
      },
      findings,
      generated_at: new Date().toISOString(),
    };
  }

  /** Analyse all servers in parallel and return posture list sorted by score asc. */
  async analyzeAll(windowHours = 24): Promise<ServerPosture[]> {
    const { rows } = await this.pool.query(`SELECT id FROM servers ORDER BY name`);
    const results = await Promise.all(
      rows.map((r) => this.analyzeServer(r.id, windowHours).catch(() => null)),
    );
    return (results.filter(Boolean) as ServerPosture[]).sort((a, b) => a.score - b.score);
  }

  // ── Individual checks ────────────────────────────────────────────────────

  private async analyzeSshBruteForce(serverId: string, w: number): Promise<Finding[]> {
    const { rows } = await this.pool.query(
      `SELECT source_ip::text AS ip,
              count(*)::int AS attempts,
              min(time) AS first_seen,
              max(time) AS last_seen
         FROM security_events
        WHERE server_id = $1
          AND event_type = 'ssh_failed_login'
          AND time > now() - ($2 || ' hours')::interval
          AND source_ip IS NOT NULL
        GROUP BY source_ip
       HAVING count(*) >= 5
        ORDER BY attempts DESC
        LIMIT 10`,
      [serverId, w],
    );
    if (!rows.length) return [];

    const topIp = rows[0];
    const totalAttempts = rows.reduce((s: number, r: any) => s + r.attempts, 0);

    return [{
      id: `ssh_brute_force`,
      category: 'authentication',
      severity: topIp.attempts >= 100 ? 'critical' : topIp.attempts >= 20 ? 'high' : 'medium',
      title: 'SSH Brute-Force Attack',
      description: `${rows.length} source IP${rows.length > 1 ? 's are' : ' is'} repeatedly failing SSH authentication. This indicates an active brute-force or credential-stuffing attack.`,
      evidence: [
        { label: 'Total failed logins', value: totalAttempts },
        { label: 'Attacking IPs', value: rows.length },
        { label: 'Top offender', value: `${topIp.ip} (${topIp.attempts} attempts)` },
        { label: 'Period', value: `${w}h` },
      ],
      remediation: [
        { step: 'Install and enable fail2ban to auto-ban IPs after N failures', command: 'apt install fail2ban -y && systemctl enable --now fail2ban' },
        { step: 'Disable password auth; use SSH keys only', command: 'sed -i "s/^#\\?PasswordAuthentication.*/PasswordAuthentication no/" /etc/ssh/sshd_config && systemctl reload sshd' },
        { step: 'Move SSH to a non-standard port (e.g. 2222)', command: 'sed -i "s/^#\\?Port .*/Port 2222/" /etc/ssh/sshd_config && systemctl reload sshd' },
        { step: `Block top attacker immediately`, command: `ufw deny from ${topIp.ip}` },
        { step: 'Allow SSH only from known IP ranges', command: 'ufw allow from YOUR_IP to any port 22' },
      ],
      first_seen: topIp.first_seen,
      last_seen: topIp.last_seen,
      count: totalAttempts,
    }];
  }

  private async analyzeCredentialStuffing(serverId: string, w: number): Promise<Finding[]> {
    const { rows } = await this.pool.query(
      `SELECT source_ip::text AS ip,
              count(*) FILTER (WHERE event_type = 'ssh_failed_login')::int AS failures,
              count(*) FILTER (WHERE event_type = 'ssh_login')::int AS successes,
              max(time) AS last_seen
         FROM security_events
        WHERE server_id = $1
          AND event_type IN ('ssh_failed_login', 'ssh_login')
          AND time > now() - ($2 || ' hours')::interval
          AND source_ip IS NOT NULL
        GROUP BY source_ip
       HAVING count(*) FILTER (WHERE event_type = 'ssh_failed_login') >= 3
          AND count(*) FILTER (WHERE event_type = 'ssh_login') >= 1
        ORDER BY successes DESC
        LIMIT 5`,
      [serverId, w],
    );
    if (!rows.length) return [];

    return [{
      id: 'credential_stuffing',
      category: 'authentication',
      severity: 'critical',
      title: 'Successful Login After Multiple Failures (Credential Stuffing)',
      description: `${rows.length} IP(s) had multiple failed SSH attempts followed by a successful login. This strongly suggests compromised credentials were used.`,
      evidence: rows.map((r: any) => ({
        label: r.ip,
        value: `${r.failures} failures → ${r.successes} success`,
      })),
      remediation: [
        { step: 'Immediately audit active sessions and kill any suspicious ones', command: 'who && pkill -u COMPROMISED_USER' },
        { step: 'Force password change for affected users', command: 'passwd USERNAME' },
        { step: 'Rotate all SSH keys for the affected accounts', command: 'cat /dev/null > /home/USER/.ssh/authorized_keys' },
        { step: 'Review recent commands run by the account', command: 'last && journalctl _COMM=bash -n 200' },
        { step: 'Disable password authentication', command: 'sed -i "s/^#\\?PasswordAuthentication.*/PasswordAuthentication no/" /etc/ssh/sshd_config && systemctl reload sshd' },
      ],
      last_seen: rows[0].last_seen,
      count: rows.length,
    }];
  }

  private async analyzeNginxAttacks(serverId: string, w: number): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Exploit probes (.env, .git, phpMyAdmin, shells, etc.)
    const { rows: probeRows } = await this.pool.query(
      `SELECT source_ip::text AS ip,
              count(*)::int AS c,
              min(time) AS first_seen,
              max(time) AS last_seen,
              array_agg(DISTINCT message ORDER BY message) FILTER (WHERE message IS NOT NULL) AS samples
         FROM security_events
        WHERE server_id = $1
          AND event_type = 'nginx_exploit_probe'
          AND time > now() - ($2 || ' hours')::interval
        GROUP BY source_ip
        ORDER BY c DESC
        LIMIT 10`,
      [serverId, w],
    );
    if (probeRows.length) {
      const total = probeRows.reduce((s: number, r: any) => s + r.c, 0);
      findings.push({
        id: 'nginx_exploit_probes',
        category: 'webserver',
        severity: total >= 50 ? 'critical' : 'high',
        title: 'Web Exploit Probes Detected (Nginx)',
        description: `Attackers are probing for common web vulnerabilities: exposed .env files, .git directories, phpMyAdmin, WordPress admin panels, and shell scripts. If any of these paths respond with HTTP 200, credentials or source code may be exposed.`,
        evidence: [
          { label: 'Total probe requests', value: total },
          { label: 'Unique source IPs', value: probeRows.length },
          { label: 'Example probes', value: (probeRows[0].samples || []).slice(0, 3).join(' | ').substring(0, 200) },
        ],
        remediation: [
          { step: 'Ensure .env and .git are not accessible — add to nginx config', command: 'location ~ /\\.(?:env|git|ht) { deny all; return 404; }' },
          { step: 'Block the top attacking IPs immediately', command: probeRows.slice(0, 3).map((r: any) => `ufw deny from ${r.ip}`).join('\n') },
          { step: 'Install ModSecurity WAF for nginx', command: 'apt install libnginx-mod-security2 -y' },
          { step: 'Rate-limit requests per IP in nginx', command: 'limit_req_zone $binary_remote_addr zone=one:10m rate=10r/s;\nlimit_req zone=one burst=20;' },
        ],
        first_seen: probeRows[0].first_seen,
        last_seen: probeRows[0].last_seen,
        count: total,
      });
    }

    // Path traversal
    const { rows: travRows } = await this.pool.query(
      `SELECT count(*)::int AS c, min(time) AS first_seen, max(time) AS last_seen,
              count(DISTINCT source_ip)::int AS ips
         FROM security_events
        WHERE server_id = $1 AND event_type = 'nginx_path_traversal'
          AND time > now() - ($2 || ' hours')::interval`,
      [serverId, w],
    );
    if (travRows[0]?.c > 0) {
      findings.push({
        id: 'nginx_path_traversal',
        category: 'webserver',
        severity: 'high',
        title: 'Path Traversal Attempts (Directory Climbing)',
        description: `Requests containing ../ or encoded variants were detected. Attackers are attempting to read files outside the web root, such as /etc/passwd or application configs.`,
        evidence: [
          { label: 'Traversal attempts', value: travRows[0].c },
          { label: 'Unique IPs', value: travRows[0].ips },
        ],
        remediation: [
          { step: 'Nginx already blocks most traversal via root/alias directives, but verify:', command: 'nginx -t && grep -r "root " /etc/nginx/' },
          { step: 'Deny any request with ../ in URI explicitly', command: 'if ($request_uri ~* "\\.\\.") { return 403; }' },
          { step: 'Enable ModSecurity rule set (CRS) which blocks traversal', command: 'apt install libnginx-mod-security2 -y' },
        ],
        first_seen: travRows[0].first_seen,
        last_seen: travRows[0].last_seen,
        count: travRows[0].c,
      });
    }

    // Scanner bots
    const { rows: scanRows } = await this.pool.query(
      `SELECT count(*)::int AS c, count(DISTINCT source_ip)::int AS ips,
              max(time) AS last_seen
         FROM security_events
        WHERE server_id = $1 AND event_type = 'nginx_scan'
          AND time > now() - ($2 || ' hours')::interval`,
      [serverId, w],
    );
    if (scanRows[0]?.c >= 5) {
      findings.push({
        id: 'nginx_scanners',
        category: 'webserver',
        severity: 'medium',
        title: 'Vulnerability Scanners / Bots Detected',
        description: `Known vulnerability scanner user-agents (sqlmap, nikto, masscan, gobuster, etc.) were detected hitting this server. Scanners map your attack surface before targeted exploitation.`,
        evidence: [
          { label: 'Scanner requests', value: scanRows[0].c },
          { label: 'Unique scanner IPs', value: scanRows[0].ips },
        ],
        remediation: [
          { step: 'Block known scanner user-agents in nginx', command: 'if ($http_user_agent ~* "(sqlmap|nikto|masscan|dirbuster|gobuster|nuclei|acunetix)") { return 403; }' },
          { step: 'Enable fail2ban nginx-botsearch jail', command: 'cat /etc/fail2ban/jail.d/nginx-botsearch.conf' },
          { step: 'Use Cloudflare or similar WAF/CDN to absorb scanner traffic', command: '' },
        ],
        last_seen: scanRows[0].last_seen,
        count: scanRows[0].c,
      });
    }

    // SQLi / XSS via nginx
    const { rows: webAttackRows } = await this.pool.query(
      `SELECT event_type, count(*)::int AS c, count(DISTINCT source_ip)::int AS ips,
              max(time) AS last_seen
         FROM security_events
        WHERE server_id = $1
          AND event_type IN ('sql_injection', 'xss')
          AND time > now() - ($2 || ' hours')::interval
        GROUP BY event_type`,
      [serverId, w],
    );
    for (const row of webAttackRows) {
      findings.push({
        id: `web_attack_${row.event_type}`,
        category: 'webserver',
        severity: row.event_type === 'sql_injection' ? 'critical' : 'high',
        title: row.event_type === 'sql_injection' ? 'SQL Injection Attempts' : 'Cross-Site Scripting (XSS) Attempts',
        description: row.event_type === 'sql_injection'
          ? 'SQL injection payloads were detected in HTTP request URIs. If any succeed, attackers could dump or corrupt your database.'
          : 'XSS payloads were detected in HTTP requests. Successful injection could steal session tokens or redirect users.',
        evidence: [
          { label: 'Attempts', value: row.c },
          { label: 'Source IPs', value: row.ips },
        ],
        remediation: [
          { step: 'Install and configure ModSecurity with OWASP CRS', command: 'apt install libnginx-mod-security2 -y && wget https://github.com/coreruleset/coreruleset/archive/main.tar.gz' },
          { step: 'Ensure all database queries use parameterised statements', command: '' },
          ...(row.event_type === 'xss'
            ? [{ step: 'Add Content-Security-Policy header in nginx', command: 'add_header Content-Security-Policy "default-src \'self\'";' }]
            : []),
        ],
        last_seen: row.last_seen,
        count: row.c,
      });
    }

    return findings;
  }

  private async analyzeFirewallStatus(serverId: string, w: number): Promise<Finding[]> {
    const { rows } = await this.pool.query(
      `SELECT message, time FROM security_events
        WHERE server_id = $1
          AND event_type IN ('firewall_disabled', 'firewall_weak')
          AND time > now() - ($2 || ' hours')::interval
        ORDER BY time DESC LIMIT 1`,
      [serverId, w],
    );
    if (!rows.length) return [];

    return [{
      id: 'firewall_disabled',
      category: 'firewall',
      severity: 'critical',
      title: 'Firewall is Disabled or Not Configured',
      description: 'The server has no active firewall. All ports are reachable from the internet, exposing every service (databases, caches, internal APIs) to direct attack.',
      evidence: [{ label: 'Status', value: rows[0].message }],
      remediation: [
        { step: 'Enable UFW and set a default-deny policy', command: 'ufw default deny incoming && ufw default allow outgoing' },
        { step: 'Allow only SSH (and any other required ports)', command: 'ufw allow 22/tcp\nufw allow 80/tcp\nufw allow 443/tcp' },
        { step: 'Enable UFW', command: 'ufw --force enable && ufw status verbose' },
        { step: 'Verify the rule set looks correct', command: 'ufw status numbered' },
      ],
      last_seen: rows[0].time,
      count: 1,
    }];
  }

  private async analyzeFirewallBlockPatterns(serverId: string, w: number): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Top persistent attackers being blocked by firewall
    const { rows: blockRows } = await this.pool.query(
      `SELECT source_ip::text AS ip, count(*)::int AS blocks,
              min(time) AS first_seen, max(time) AS last_seen
         FROM security_events
        WHERE server_id = $1 AND event_type = 'firewall_block'
          AND time > now() - ($2 || ' hours')::interval
          AND source_ip IS NOT NULL
        GROUP BY source_ip
       HAVING count(*) >= 30
        ORDER BY blocks DESC
        LIMIT 10`,
      [serverId, w],
    );
    if (blockRows.length) {
      const total = blockRows.reduce((s: number, r: any) => s + r.blocks, 0);
      findings.push({
        id: 'persistent_attackers',
        category: 'firewall',
        severity: 'medium',
        title: 'Persistent Attackers Being Blocked by Firewall',
        description: `${blockRows.length} IPs are repeatedly hitting the firewall. While the firewall is blocking them, these persistent probes waste resources and indicate your server is a known target. Permanently banning these IPs will reduce noise and attack surface.`,
        evidence: [
          { label: 'Total blocks', value: total },
          { label: 'Top attacker', value: `${blockRows[0].ip} (${blockRows[0].blocks} blocks)` },
          { label: 'IPs above 30 blocks', value: blockRows.length },
        ],
        remediation: [
          { step: 'Permanently deny the top offenders', command: blockRows.slice(0, 5).map((r: any) => `ufw insert 1 deny from ${r.ip}`).join('\n') },
          { step: 'Configure fail2ban with a long bantime for repeat offenders', command: 'echo "[DEFAULT]\nbantime = 86400\nfindtime = 3600\nmaxretry = 3" > /etc/fail2ban/jail.local && systemctl restart fail2ban' },
          { step: 'Consider using ipset for bulk IP blocking (more efficient at scale)', command: 'apt install ipset -y' },
        ],
        first_seen: blockRows[0].first_seen,
        last_seen: blockRows[0].last_seen,
        count: total,
      });
    }

    // Check if dangerous internal service ports are being probed
    const { rows: dangerousProbes } = await this.pool.query(
      `SELECT message, count(*)::int AS c FROM security_events
        WHERE server_id = $1 AND event_type = 'firewall_block'
          AND time > now() - ($2 || ' hours')::interval
          AND (message ILIKE '%:3306%' OR message ILIKE '%:5432%' OR
               message ILIKE '%:6379%' OR message ILIKE '%:27017%' OR
               message ILIKE '%:9200%' OR message ILIKE '%:2375%')
        GROUP BY message
        ORDER BY c DESC LIMIT 5`,
      [serverId, w],
    );
    if (dangerousProbes.length) {
      findings.push({
        id: 'dangerous_port_probes',
        category: 'firewall',
        severity: 'high',
        title: 'Database / Internal Service Ports Being Probed',
        description: 'Attackers are scanning for exposed databases (MySQL, PostgreSQL, Redis, MongoDB, Elasticsearch) or Docker daemon. The firewall is blocking these, but the services should not be reachable at all from the internet.',
        evidence: dangerousProbes.slice(0, 5).map((r: any) => ({ label: 'Blocked', value: `${r.c}× ${r.message?.substring(0, 80)}` })),
        remediation: [
          { step: 'Bind database services to localhost only (not 0.0.0.0)', command: '# MySQL: bind-address = 127.0.0.1 in /etc/mysql/mysql.conf.d/mysqld.cnf\n# Redis: bind 127.0.0.1 in /etc/redis/redis.conf\n# PostgreSQL: listen_addresses = \'localhost\' in postgresql.conf' },
          { step: 'Verify no database port is listening on a public interface', command: 'ss -tlnp | grep -E "3306|5432|6379|27017|9200|2375"' },
          { step: 'Use UFW to explicitly deny these ports even if accidentally exposed', command: 'ufw deny 3306 && ufw deny 6379 && ufw deny 27017 && ufw deny 9200' },
        ],
        count: dangerousProbes.reduce((s: number, r: any) => s + r.c, 0),
      });
    }

    return findings;
  }

  private async analyzeMalware(serverId: string, w: number): Promise<Finding[]> {
    const { rows } = await this.pool.query(
      `SELECT event_type, count(*)::int AS c,
              max(message) AS last_message, max(time) AS last_seen
         FROM security_events
        WHERE server_id = $1
          AND event_type IN ('malware', 'rootkit', 'ransomware')
          AND time > now() - ($2 || ' hours')::interval
        GROUP BY event_type`,
      [serverId, w],
    );
    return rows.map((r: any) => ({
      id: `malware_${r.event_type}`,
      category: 'system' as FindingCategory,
      severity: 'critical' as FindingSeverity,
      title: r.event_type === 'ransomware' ? 'Ransomware Indicators Detected' :
             r.event_type === 'rootkit' ? 'Rootkit Detected' : 'Malware Detected',
      description: r.event_type === 'ransomware'
        ? 'Ransomware file patterns or indicators found. Immediately isolate this server and begin incident response.'
        : r.event_type === 'rootkit'
        ? 'Rootkit signatures detected by rkhunter or chkrootkit. The system may be fully compromised.'
        : 'Malware detected by ClamAV or antivirus tooling. Files should be quarantined and the infection vector identified.',
      evidence: [
        { label: 'Detections', value: r.c },
        { label: 'Last detection', value: r.last_message?.substring(0, 120) ?? '' },
      ],
      remediation: [
        { step: 'URGENT: Snapshot the server disk for forensics, then isolate it from the network', command: '' },
        { step: 'Run a full ClamAV scan', command: 'clamscan -r / --infected --remove 2>&1 | tee /root/clamscan.log' },
        { step: 'Run rkhunter for rootkit verification', command: 'rkhunter --update && rkhunter --check --skip-keypress 2>&1 | tee /root/rkhunter.log' },
        { step: 'Check for unexpected SUID/SGID binaries', command: 'find / -perm /6000 -type f 2>/dev/null | grep -v /proc' },
        { step: 'Check for recently modified system binaries', command: 'find /usr/bin /usr/sbin /bin /sbin -newer /etc/passwd -type f' },
        { step: 'Review and revoke all user sessions and credentials on this machine', command: 'who && lastlog | head -30' },
      ],
      last_seen: r.last_seen,
      count: r.c,
    }));
  }

  private async analyzeSuspiciousProcesses(serverId: string, w: number): Promise<Finding[]> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS c, max(message) AS sample, max(time) AS last_seen
         FROM security_events
        WHERE server_id = $1 AND event_type = 'suspicious_process'
          AND time > now() - ($2 || ' hours')::interval`,
      [serverId, w],
    );
    if (!rows[0]?.c) return [];
    return [{
      id: 'suspicious_processes',
      category: 'system',
      severity: 'high',
      title: 'Suspicious Processes Executed',
      description: 'Network tools (nc, nmap, socat) or download utilities (wget, curl) were executed in contexts that look suspicious. These are commonly used in post-exploitation for reverse shells, lateral movement, or data staging.',
      evidence: [
        { label: 'Suspicious executions', value: rows[0].c },
        { label: 'Example', value: rows[0].sample?.substring(0, 120) ?? '' },
      ],
      remediation: [
        { step: 'Review active network connections', command: 'ss -tlnp && ss -tunap' },
        { step: 'Check for unexpected processes', command: 'ps auxf | grep -E "(nc|ncat|socat|nmap|wget|curl)" | grep -v grep' },
        { step: 'Check crontab and systemd for persistence', command: 'crontab -l && ls /etc/cron.* && systemctl list-units --type=service --state=running' },
        { step: 'Use AppArmor or seccomp to restrict tool access', command: 'aa-status && apparmor_parser -r /etc/apparmor.d/*' },
      ],
      last_seen: rows[0].last_seen,
      count: rows[0].c,
    }];
  }

  private async analyzeFileIntegrity(serverId: string, w: number): Promise<Finding[]> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS c, max(message) AS sample,
              min(time) AS first_seen, max(time) AS last_seen
         FROM security_events
        WHERE server_id = $1 AND event_type = 'file_integrity_change'
          AND time > now() - ($2 || ' hours')::interval`,
      [serverId, w],
    );
    if (!rows[0]?.c) return [];
    return [{
      id: 'file_integrity',
      category: 'system',
      severity: rows[0].c >= 10 ? 'high' : 'medium',
      title: 'File Integrity Changes Detected',
      description: 'AIDE, Tripwire, or inotify detected unexpected changes to monitored files. This may indicate tampered binaries, planted backdoors, or unauthorized config changes.',
      evidence: [
        { label: 'File changes', value: rows[0].c },
        { label: 'Example change', value: rows[0].sample?.substring(0, 120) ?? '' },
      ],
      remediation: [
        { step: 'Review the full AIDE/Tripwire report', command: 'aide --check 2>&1 | head -50' },
        { step: 'Compare checksums of key system binaries', command: 'dpkg --verify 2>&1 | head -30' },
        { step: 'Check recently modified files in system directories', command: 'find /usr /bin /sbin /etc -mtime -1 -type f 2>/dev/null' },
        { step: 'If compromise is confirmed, re-image from a known-good snapshot', command: '' },
      ],
      first_seen: rows[0].first_seen,
      last_seen: rows[0].last_seen,
      count: rows[0].c,
    }];
  }

  private async analyzePrivilegeEscalation(serverId: string, w: number): Promise<Finding[]> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS c, max(message) AS sample,
              count(DISTINCT source_ip)::int AS ips,
              max(time) AS last_seen
         FROM security_events
        WHERE server_id = $1
          AND event_type IN ('privilege_escalation', 'data_exfiltration')
          AND time > now() - ($2 || ' hours')::interval`,
      [serverId, w],
    );
    if (!rows[0]?.c) return [];
    return [{
      id: 'privilege_escalation',
      category: 'system',
      severity: 'high',
      title: 'Privilege Escalation Attempts',
      description: 'Failed sudo/su attempts or data exfiltration via file transfer tools were detected. Repeated failures suggest an attacker with low-privileged access is attempting to gain root.',
      evidence: [
        { label: 'Escalation attempts', value: rows[0].c },
        { label: 'Example', value: rows[0].sample?.substring(0, 120) ?? '' },
      ],
      remediation: [
        { step: 'Audit /etc/sudoers and remove unnecessary NOPASSWD entries', command: 'visudo && grep -r NOPASSWD /etc/sudoers /etc/sudoers.d/' },
        { step: 'Check for SUID binaries that can be exploited for escalation', command: 'find / -perm -4000 -type f 2>/dev/null' },
        { step: 'Review running processes as root', command: 'ps aux --sort=-%cpu | grep root | head -20' },
        { step: 'Enforce PAM password policies', command: 'cat /etc/pam.d/common-auth' },
      ],
      last_seen: rows[0].last_seen,
      count: rows[0].c,
    }];
  }

  private async analyzeOpenPorts(serverId: string, w: number): Promise<Finding[]> {
    const { rows } = await this.pool.query(
      `SELECT raw, message, time FROM security_events
        WHERE server_id = $1 AND event_type = 'open_ports_snapshot'
        ORDER BY time DESC LIMIT 1`,
      [serverId, w],
    );
    if (!rows[0]?.raw) return [];

    const snap = rows[0].raw as { all_ports?: number[]; dangerous_exposed?: { port: number; service: string }[] };
    const dangerous = snap.dangerous_exposed || [];
    if (!dangerous.length) return [];

    return [{
      id: 'dangerous_ports_open',
      category: 'exposure',
      severity: dangerous.some((d) => [2375, 6379, 9200].includes(d.port)) ? 'critical' : 'high',
      title: 'Dangerous Services Exposed on Network Interfaces',
      description: `The following services are listening and may be reachable from external networks: ${dangerous.map((d) => `${d.service} (port ${d.port})`).join(', ')}. These services are typically not intended to be publicly accessible.`,
      evidence: [
        ...dangerous.map((d) => ({ label: `Port ${d.port}`, value: d.service })),
        { label: 'Total open ports', value: (snap.all_ports || []).length },
      ],
      remediation: [
        { step: 'Verify which interface each service is bound to', command: 'ss -tlnp | grep -E "' + dangerous.map((d) => d.port).join('|') + '"' },
        { step: 'Bind services to localhost only — edit their config files', command: dangerous.map((d) => `# ${d.service}: set bind/listen_address to 127.0.0.1`).join('\n') },
        { step: 'Block the ports via UFW even as a safety net', command: dangerous.map((d) => `ufw deny ${d.port}`).join('\n') },
        { step: 'If remote access is needed, use SSH tunnel instead of opening the port', command: 'ssh -L 5432:localhost:5432 user@server  # tunnel PostgreSQL locally' },
      ],
      last_seen: rows[0].time,
      count: dangerous.length,
    }];
  }

  private async analyzeDataExfiltration(serverId: string, w: number): Promise<Finding[]> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS c, max(message) AS sample, max(time) AS last_seen
         FROM security_events
        WHERE server_id = $1 AND event_type = 'data_exfiltration'
          AND time > now() - ($2 || ' hours')::interval`,
      [serverId, w],
    );
    if (!rows[0]?.c) return [];
    return [{
      id: 'data_exfiltration',
      category: 'system',
      severity: 'critical',
      title: 'Potential Data Exfiltration Detected',
      description: 'File transfer commands (scp, rsync, sftp, ftp) were executed in ways consistent with data being copied off the server. This may indicate an attacker staging or stealing data.',
      evidence: [
        { label: 'Exfiltration events', value: rows[0].c },
        { label: 'Detail', value: rows[0].sample?.substring(0, 120) ?? '' },
      ],
      remediation: [
        { step: 'Check recent large outbound transfers', command: 'iftop -t -s 30 2>/dev/null || nethogs 2>/dev/null' },
        { step: 'Review auditd logs for file access patterns', command: 'ausearch -c scp -c rsync -c sftp 2>/dev/null | tail -40' },
        { step: 'Check for large files recently created or modified', command: 'find / -type f -size +10M -mtime -1 2>/dev/null | grep -v /proc | head -20' },
        { step: 'Restrict outbound connections to only necessary destinations', command: 'ufw default deny outgoing && ufw allow out 80/tcp && ufw allow out 443/tcp' },
      ],
      last_seen: rows[0].last_seen,
      count: rows[0].c,
    }];
  }

  private async analyzeHighResourceUsage(serverId: string, _w: number): Promise<Finding[]> {
    const { rows } = await this.pool.query(
      `SELECT avg(cpu_usage)::numeric(5,1) AS avg_cpu,
              max(cpu_usage)::numeric(5,1) AS max_cpu,
              avg(memory_usage)::numeric(5,1) AS avg_mem,
              max(memory_usage)::numeric(5,1) AS max_mem
         FROM metrics
        WHERE server_id = $1 AND time > now() - interval '1 hour'`,
      [serverId],
    );
    const r = rows[0];
    if (!r) return [];

    const findings: Finding[] = [];

    if (Number(r.avg_cpu) >= 85) {
      findings.push({
        id: 'high_cpu_sustained',
        category: 'system',
        severity: Number(r.avg_cpu) >= 95 ? 'critical' : 'high',
        title: 'Sustained High CPU Usage (Possible Cryptominer)',
        description: `CPU has averaged ${r.avg_cpu}% over the last hour. Sustained high CPU with no obvious workload change can indicate a cryptominer, infinite loop, or denial-of-service condition.`,
        evidence: [
          { label: 'Average CPU (1h)', value: `${r.avg_cpu}%` },
          { label: 'Peak CPU (1h)', value: `${r.max_cpu}%` },
        ],
        remediation: [
          { step: 'Identify top CPU consuming processes', command: 'ps aux --sort=-%cpu | head -15' },
          { step: 'Check for known cryptominer process names', command: 'ps aux | grep -E "(xmrig|minerd|cpuminer|ethminer|cgminer)" | grep -v grep' },
          { step: 'Check for hidden processes and network connections', command: 'ss -tunap && ls /proc/*/exe 2>/dev/null | xargs ls -la 2>/dev/null | grep -v "No such"' },
          { step: 'If a cryptominer is found, kill the process and check crontab for persistence', command: 'kill -9 PID && crontab -l && cat /etc/cron.d/*' },
        ],
        count: 1,
      });
    }

    return findings;
  }

  // ── Scoring ───────────────────────────────────────────────────────────────

  private computeScore(findings: Finding[]): number {
    const WEIGHTS: Record<FindingSeverity, number> = { critical: 30, high: 12, medium: 5, low: 2 };
    const CAPS:    Record<FindingSeverity, number> = { critical: 2,  high: 4,  medium: 6, low: 10 };

    let deduction = 0;
    const counts: Partial<Record<FindingSeverity, number>> = {};
    for (const f of findings) {
      counts[f.severity] = (counts[f.severity] || 0) + 1;
    }
    for (const sev of SEV_ORDER) {
      const c = Math.min(counts[sev] || 0, CAPS[sev]);
      deduction += c * WEIGHTS[sev];
    }
    return Math.max(0, 100 - deduction);
  }

  private grade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 50) return 'C';
    if (score >= 25) return 'D';
    return 'F';
  }
}
