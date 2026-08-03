# Plain Ubuntu + Node for exercising the real monitor-agent .deb — dpkg -i,
# postinst, prerm/purge — without a full systemd-in-Docker setup (fragile on
# Docker Desktop for Windows; not needed to validate the package/agent
# themselves, since postinst's systemctl calls already no-op via `|| true`
# when there's no systemd running). The agent process is started directly
# with `docker exec` instead of via the unit.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

CMD ["sleep", "infinity"]
