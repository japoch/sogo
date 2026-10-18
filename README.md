# SOGo for Docker

[![Docker Image CI](https://github.com/japoch/SOGo/actions/workflows/docker-image.yml/badge.svg)](https://github.com/japoch/SOGo/actions/workflows/docker-image.yml)
[![Codacy Security Scan](https://github.com/japoch/SOGo/actions/workflows/codacy.yml/badge.svg)](https://github.com/japoch/SOGo/actions/workflows/codacy.yml)
[![CodeQL Advanced](https://github.com/japoch/sogo/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/japoch/sogo/actions/workflows/codeql.yml)

[SOGo](http://www.sogo.nu) is an open-source groupware server (GNU GPL/LGPL v2+). This [GHCR image](https://github.com/japoch/sogo/pkgs/container/sogo) builds [SOGo](https://github.com/Alinto/sogo) and [SOPE](https://github.com/Alinto/sope) from source with NGINX and memcached.

## Platforms

| Host | Docker platform |
| --- | --- |
| x86-64 Linux (Intel/AMD) | `linux/amd64` |
| Raspberry Pi 3 or 4 with a 32-bit OS | `linux/arm/v7` |
| Raspberry Pi 3 or 4 with a 64-bit OS | `linux/arm64` |

ARM64 requires a 64-bit OS; `linux/arm/v8` is not ARM64. Docker selects the matching image automatically.

## Setup

Set `VERSION` in `.env`. On Raspberry Pi, also set `PLATFORM` from the table and verify architecture support for the configured database, mail, and phpMyAdmin image tags; these services default to AMD64.

```bash
docker compose up -d
docker compose logs -f
```

To run the SOGo container separately (requires an external database):

```bash
docker run --rm --name sogo ghcr.io/japoch/sogo:1.2.0
```

Optional systemd service:

```bash
cp ./artifacts/sogo-docker.service /etc/systemd/system
systemctl enable --now sogo-docker.service
journalctl -u sogo-docker.service -f
```

### Configuration

- **Database and mail:** Configure `sogo-conf/sogo.conf` using SOGo's database, MTA, and SMTP authentication documentation.
- **NGINX and HTTPS:** Edit `artifacts/nginx.conf` and `nginx-conf/sites-enabled/sogo-nginx.conf`; provide certificates in the container. Exposed ports: 80, 443, and 20000 (SOGo).
- **Workers:** Size `WOWorkersCount` in `sogo.conf` for your workload.
- **Cron:** Edit `artifacts/sogo.cron` for backups, session cleanup, and Sieve. Uncomment the backup job and rebuild to enable scheduled backups.

Generate a self-signed certificate for Dovecot:

```bash
openssl req -newkey rsa:4096 -sha512 -x509 -days 365 -nodes \
  -keyout dovecot-root/certs/dovecot_cert/smtp.key \
  -out dovecot-root/certs/dovecot_cert/smtp-key.pem
```

## Build

Requires Docker with Buildx. Set upstream versions in `versions.yaml`; set `VERSION` and `BUILD_PLATFORMS` in `.env`.

### Local builds

Build for the test host's platform, for example ARM64:

```bash
docker buildx build --platform linux/arm64 --load -t ghcr.io/japoch/sogo:local-test .
```

### Releases with GitHub Actions

Prepare a PR with a new `.env` `VERSION` and a matching `## [VERSION] - YYYY-MM-DD` changelog section. Move only released changes from `Unreleased`; they become the release notes.

| Trigger | Build | Publish to GHCR | GitHub release |
| --- | --- | --- | --- |
| Relevant push to `main`, or manual `v*` tag matching `.env` | All three platforms | Yes | Yes |
| Relevant pull request to `main` or `release/**` | AMD64 | No | No |
| Manual workflow run | Selected `build_platforms` (default: all three) | Only with `publish_image: true` | No |

The [workflow](.github/workflows/docker-image.yml) skips documentation-only and Compose-only changes; neither needs a version bump. Tag pushes bypass path filters.

Releases follow **merge → build → publish → verify → update latest → tag and release**. Verification covers the digest, platforms, version/revision labels, and index description. The workflow creates `v<VERSION>` at the built commit and records the image digest in the release.

Images use complete version tags and `latest`; no major or minor aliases. Prereleases such as `1.3.0-rc.1` and older versions never replace `latest`. Version tags and images are not overwritten; changed build inputs require a new version.

Repository rules must let `GITHUB_TOKEN` create `v*` tags with `contents: write`. No manual tagging or extra PAT is needed.

To repair `latest` for an existing release (for example `1.3.1`), run **Create and publish Docker image** from a branch with this workflow and the desired `.env` `VERSION`. Set `publish_image: true`, `latest_only: true`, and the published `build_platforms`. This verifies and copies the released digest without rebuilding. Only this mode can replace a legacy alias without version labels; inconsistent metadata requires manual review.

After attestation or release failure, rerun jobs in the original push run; matching images are reused. Draft or inconsistent releases need manual review. If a released image was deleted, publish a new version.

Test publishing safeguards: `node --test .github/scripts/test_release_image.cjs .github/scripts/test_delete_old_packages.cjs`.

`IMAGE_DESCRIPTION` sets the image label and GHCR index description. Metadata changes require a new release because they change the digest.

### Publish locally

Save a classic PAT with `write:packages` in the ignored `.ghcr-token` file ([GHCR authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry)). Replace `GITHUB_USERNAME` and run in Bash:

```bash
docker login ghcr.io --username GITHUB_USERNAME --password-stdin < .ghcr-token
source .env
docker buildx create --name sogo-builder --driver docker-container --use # once
docker buildx build --platform "$BUILD_PLATFORMS" -t "ghcr.io/japoch/sogo:$VERSION" --push .
docker logout ghcr.io
```

Cross-platform builds may need [QEMU](https://docs.docker.com/build/building/multi-platform/#qemu); GitHub Actions sets it up automatically.

## Usage

### Container image cleanup

Run **Delete old Docker images** manually with `dry_run: true` to preview, then `false` to delete. Defaults retain the two newest release-only versions (`keep_versions: 2`) and uploads created or updated within seven days (`min_age_hours: 168`, minimum 24).

Cleanup verifies manifest references and protects aliases such as `latest`, recent uploads, and their dependencies. Keep an alias for images used only by digest; those consumers cannot be detected. Each run deletes at most 100 releases and orphans, removing parents before dependencies.

Publishing and cleanup share a workflow lock; keep external publishers idle. Cleanup rechecks inventory before deletion and stops on changes or manifest errors. Registry reads and deletes are not atomic.

Deletion requires `packages: write` and repository **Admin** access under **Package settings → Manage Actions access** ([permissions](https://docs.github.com/en/packages/learn-github-packages/deleting-and-restoring-a-package)).

### User management

Set user details, then choose a command:

```bash
sogo_user='user.name'
sogo_pass='password'
sogo_name='User Name'
sogo_fqhn='localhost'

# List users
docker compose exec db mysql -u sogo -ppassword -D sogo -e "SELECT * FROM sogo_view;"

# Add a user
docker compose exec db mysql -u sogo -ppassword -D sogo -e "INSERT INTO sogo_view VALUES('$sogo_user', '$sogo_user', MD5('$sogo_pass'), '$sogo_name', '$sogo_user@$sogo_fqhn');"

# Change a password
docker compose exec db mysql -u sogo -ppassword -D sogo -e "UPDATE sogo_view SET c_password=MD5('$sogo_pass') WHERE c_uid='$sogo_user';"

# Remove a user
docker compose exec db mysql -u sogo -ppassword -D sogo -e "DELETE FROM sogo_view WHERE c_uid='$sogo_user';"
```

Upgrade the database after upgrading the database client:

```bash
docker compose exec db mariadb-upgrade -u root -ppassword
```

### Backup and restore

Open a shell with `docker compose exec sogo bash`, then use:

```bash
# Back up all users (replace ALL with a username for one user)
sogo-tool backup /mnt/backup ALL

# List a user's backup
sogo-tool restore -l /mnt/backup username

# Restore settings, including signatures and filters
sogo-tool restore -p /mnt/backup username

# Restore calendars and contacts
sogo-tool restore -f ALL /mnt/backup username
```

Alternatively, use SOGo's browser import/export feature.

## Troubleshooting

### Data too long for column 'c_value'

Enlarge the session column for longer cookies ([SOGo issue #5491](https://bugs.sogo.nu/view.php?id=5491)):

```sql
ALTER TABLE sogo_sessions_folder MODIFY c_value VARCHAR(4096) NOT NULL;
```
