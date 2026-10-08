# Running a community node

A node is **one binary and one SQLite file**. It needs no database server,
queue or cache, and it never holds keys that can read community content
(see [threat-model.md](threat-model.md)): if the machine is lost or seized,
the community loses availability, not privacy, and an admin can rebuild it
elsewhere from their phone.

Typical footprint: a few MB of RAM per active community, disk growing with
the encrypted log until snapshots let it be compacted. A Raspberry Pi 4, a
small VPS or a spare computer is plenty.

## Pick a way to run it

### 1. Docker Compose with automatic TLS (recommended for a VPS)

```sh
git clone <this repository> && cd vamo-virar/deploy
cat > .env <<'ENV'
DOMAIN=node.example.org
VV_PROVISIONING_TOKEN=$(openssl rand -hex 24)   # paste the generated value
ENV
docker compose up -d
```

Point the domain's DNS at the machine first; Caddy obtains and renews the
certificate. The node is reachable only through Caddy.

### 2. Docker alone

```sh
docker build -f deploy/Dockerfile -t vamo-virar/community-node .
docker run -d --name community-node -p 127.0.0.1:8787:8787 \
  -e VV_PROVISIONING_TOKEN=<long random string> \
  -v community-node-data:/data vamo-virar/community-node
```

The image is ~50 MB (distroless, no shell), runs as a non-root user, keeps
everything in `/data`, and has a built-in health check. Put your own TLS
proxy in front. Behind a TLS-intercepting corporate proxy, pass its CA
bundle when building: `--secret id=ca_bundle,src=ca.pem`.

Release tags also publish multi-arch images (amd64, arm64) to
`ghcr.io/<owner>/community-node`.

### 3. A plain binary with systemd (Raspberry Pi, NAS, any Linux)

Download `community-node-<version>-<target>.tar.gz` from the release page
(Linux x86-64 and ARM64, macOS, Windows), or `cargo build -p community-node --release`.

```sh
sudo install -m 0755 community-node /usr/local/bin/
sudo install -m 0644 deploy/community-node.service /etc/systemd/system/
echo 'VV_PROVISIONING_TOKEN=<long random string>' | sudo tee /etc/community-node.env
sudo chmod 600 /etc/community-node.env
sudo systemctl enable --now community-node
```

The unit runs with a throwaway user and a hardened sandbox, keeps data in
`/var/lib/community-node`, and listens on `127.0.0.1:8787`; put Caddy or
nginx in front for TLS and set `VV_TRUST_FORWARDED_FOR=1` in the env file.

## Configuration

Everything has a default. Precedence: environment > flags > config file.

| Setting | Env | Default | Notes |
|---|---|---|---|
| `listen` | `VV_LISTEN` | `127.0.0.1:8787` | |
| `data_dir` | `VV_DATA_DIR` | `./data` | holds `node.sqlite` |
| `provisioning_token` | `VV_PROVISIONING_TOKEN` | none | required to create or restore a community here; give it only to people allowed to host on this node |
| `open_provisioning` | | `false` | lets anyone create communities; only on a private network |
| `trust_forwarded_for` | `VV_TRUST_FORWARDED_FOR` | `false` | set when behind a reverse proxy, so join-request rate limits apply per client |
| `epoch_grace_secs` | | 600 | old-key writes accepted after a key change |
| `compaction_grace_secs` | | 30 days | how long log entries behind a snapshot are kept |
| `max_mailbox_ttl_secs` | | 30 days | |
| `intake_per_ip_per_hour` / `intake_per_community_per_hour` | | 20 / 200 | join request limits |

See [`apps/node/config.example.toml`](../apps/node/config.example.toml).

## Backups and restore

```sh
community-node backup --data-dir /var/lib/community-node --out /backups/node-$(date +%F).sqlite
# in Docker:
docker exec community-node /usr/local/bin/community-node backup --out /data/backup.sqlite
```

`backup` uses SQLite's online backup and is safe while the node runs. To
restore, stop the node, put the file back as `node.sqlite`, start it.

Backups are a convenience, not the only copy: an admin's phone can rebuild
the community on any node (`Replica.restoreTo`, protocol §11.3), so even a
node with no backup can be replaced.

## Operating

- **Health:** `community-node health --url http://127.0.0.1:8787` exits 0
  when the node answers (the container health check uses it).
- **Logs:** `RUST_LOG=info`. The node never logs request bodies or tokens;
  the bundled Caddyfile also drops request URIs and auth headers.
- **Upgrades:** take a backup, stop, replace the binary or image, start.
  v0 creates its tables on start but has no schema migrations yet, so read
  the release notes before upgrading across versions.
- **Moving to another machine:** copy `node.sqlite` (from a backup) and
  point the DNS name at the new machine, or let an admin rebuild from their
  phone.

## What you, as an operator, can and cannot see

You can see: that communities exist (opaque ids), how many log entries and
mailbox items they have and when, the admins' public keys, IP addresses of
connecting devices (in memory, for rate limiting only), and the size and
timing of encrypted data. You cannot see names, events, who attends what,
calendars, locations, or any message content.
