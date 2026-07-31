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
`prerm` backs up a configured `agent.yaml` to `agent.yaml.bak` before removal,
and `postinst` restores it automatically if a later install lands back on the
stock placeholder — but if that recovery path doesn't fire for some reason,
the API key can't be recovered from the platform (it's stored hashed); use
**Regenerate API key** on the server's detail page in the dashboard instead
of re-registering the server from scratch.

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
