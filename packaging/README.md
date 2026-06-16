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
