# Packaging the Ubuntu agent (.deb)

## Build

On an Ubuntu/Debian machine with `dpkg-deb` and `bash`:

```bash
cd packaging
chmod +x build-deb.sh debian/postinst debian/prerm debian/postrm
./build-deb.sh
# -> dist/monitor-agent_1.0.0_all.deb
```

## Install on a target server

```bash
sudo dpkg -i monitor-agent_1.0.0_all.deb
# (if nodejs missing) sudo apt-get -f install

sudo nano /etc/monitor-agent/agent.yaml   # set server_url + api_key
sudo systemctl enable --now monitor-agent
journalctl -u monitor-agent -f
```

## Updating an already-installed agent

`build-deb.sh` doesn't bump the package version between builds, so re-running
it and `dpkg -i`-ing the result on a server that already has the agent
installed is a same-version reinstall — `/etc/monitor-agent/agent.yaml` is a
declared `conffile`, so dpkg preserves your edits automatically. This is the
supported way to update.

`dpkg -P monitor-agent` / `apt purge monitor-agent` is different: purge
deliberately deletes conffiles, including your configured `server_url` and
`api_key`. Avoid it for routine updates — use `dpkg -r` (remove, keeps
conffiles) or just reinstall over the existing install. As a safety net,
`prerm` backs up a configured `agent.yaml` to `/var/backups/monitor-agent-agent.yaml.bak`
before removal (deliberately outside `/etc/monitor-agent/` — purge removes
that whole directory, not just the declared conffile), and `postinst`
restores it automatically if a later install lands back on the stock
placeholder — but if that recovery path doesn't fire for some reason,
the API key can't be recovered from the platform (it's stored hashed); use
**Regenerate API key** on the server's detail page in the dashboard instead
of re-registering the server from scratch.

## Agent self-update

Installed agents can update themselves once `self_update.enabled: true` is
set in `agent.yaml` **and** an admin turns on the platform's global
"Agent auto-update" setting (off by default; see the dashboard's Agent
Updates page). To publish a new version for agents to pull:

1. Build the `.deb` as above (`./build-deb.sh`).
2. Sign it offline with the private key from `generate-signing-key.js`
   (never the backend — see `sign-agent-release.js`):
   ```bash
   node packaging/sign-agent-release.js dist/monitor-agent_<version>_all.deb /path/to/agent-update-signing-key.pem
   ```
3. Upload both the `.deb` and the resulting `.deb.sig` on the dashboard's
   **Agent Updates** page, along with the version number and an optional
   changelog. Set a rollout percent (0 keeps it published but inert; 100
   exposes it to every eligible server).

Each agent checks periodically, downloads, and verifies the signature
against the public key baked into its own package
(`/etc/monitor-agent/update-signing-pub.pem`) before applying anything — a
compromised backend account can serve bytes, but can't produce a signature
that verifies without the offline private key. Applying an update is handled
by `scripts/apply-update.sh`, invoked via `sudo` under a rule scoped to
exactly that script (`/etc/sudoers.d/monitor-agent-updater`); it backs up
the current install first and rolls back automatically if the new version
doesn't come up healthy within 15 seconds of restart.

## Package layout

| Path | Purpose |
|------|---------|
| `/usr/lib/monitor-agent/` | agent source + package.json |
| `/etc/monitor-agent/agent.yaml` | configuration (conffile) |
| `/lib/systemd/system/monitor-agent.service` | systemd unit |
| `/var/lib/monitor-agent/` | offline buffer (created on install) |

The `postinst` script creates the `monitor-agent` system user, installs the
`js-yaml` dependency, and enables the service. The unit caps CPU at 15% and
memory at 128M to satisfy the agent resource constraint.
