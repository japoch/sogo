# SOGo for Docker

[![Docker Image CI](https://github.com/japoch/SOGo/actions/workflows/docker-image.yml/badge.svg)](https://github.com/japoch/SOGo/actions/workflows/docker-image.yml)
[![Codacy Security Scan](https://github.com/japoch/SOGo/actions/workflows/codacy.yml/badge.svg)](https://github.com/japoch/SOGo/actions/workflows/codacy.yml)
[![CodeQL Advanced](https://github.com/japoch/sogo/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/japoch/sogo/actions/workflows/codeql.yml)

[SOGo](http://www.sogo.nu) is an open-source groupware server licensed under GNU GPL/LGPL v2 and above. This image builds [SOGo](https://github.com/Alinto/sogo) and [SOPE](https://github.com/Alinto/sope) from source and includes NGINX and memcached.

Images are available from [GHCR](https://github.com/japoch/sogo/pkgs/container/sogo).

## Platforms

Release builds target these platforms:

| Host | Docker platform |
| --- | --- |
| x86-64 Linux (Intel/AMD) | `linux/amd64` |
| Raspberry Pi 3 or 4 with a 32-bit OS | `linux/arm/v7` |
| Raspberry Pi 3 or 4 with a 64-bit OS | `linux/arm64` |

Both Pi models support [Raspberry Pi OS (64-bit)](https://www.raspberrypi.com/news/raspberry-pi-os-64-bit/). Use it for ARM64 containers; `linux/arm/v8` is not an ARM64 target. Docker selects the matching image from the release tag automatically.

## Setup

Set the image `VERSION` in `.env`, then start the Docker Compose stack. On Raspberry Pi, also set `PLATFORM` to the value from the table: the database, mail, and phpMyAdmin services otherwise default to AMD64. These third-party images must support the selected architecture; the SOGo build does not establish compatibility for the whole stack.

```bash
docker compose up -d
docker compose logs -f
```

To run the SOGo container separately (requires an external database):

```bash
docker run --rm --name sogo ghcr.io/japoch/sogo:1.2.0
```

Optionally, manage the Compose stack through systemd:

```bash
cp ./artifacts/sogo-docker.service /etc/systemd/system
systemctl enable --now sogo-docker.service
journalctl -u sogo-docker.service -f
```

### Configuration

- **Database:** Configure a separate database supported by SOGo in `sogo-conf/sogo.conf`. See the *Database Configuration* chapter of the SOGo documentation.
- **Mail:** See the SOGo documentation for MTA configuration and SMTP authentication.
- **NGINX and HTTPS:** Configuration files are in `artifacts/nginx.conf` and `nginx-conf/sites-enabled/sogo-nginx.conf`. Provide certificates in the container as needed. The image exposes ports 80 (HTTP), 443 (HTTPS), and 20000 (SOGo).
- **Workers:** Adjust `WOWorkersCount` in `sogo.conf` to match your workload; the example value of `8` may be insufficient for medium and larger instances.
- **Cron:** `artifacts/sogo.cron` contains jobs for backups, session cleanup, and Sieve. To enable scheduled backups, uncomment the backup job and rebuild. The script is installed at `/usr/local/share/doc/sogo/sogo-backup.sh`.

Generate a self-signed certificate for Dovecot:

```bash
openssl req -newkey rsa:4096 -sha512 -x509 -days 365 -nodes \
  -keyout dovecot-root/certs/dovecot_cert/smtp.key \
  -out dovecot-root/certs/dovecot_cert/smtp-key.pem
```

## Build

Requires Docker with Buildx. SOGo and SOPE source versions are set in `versions.yaml`; the image version and local build platforms are set in `.env`.

### Local builds

Build and load a single platform for local testing. Choose `--platform` from the table above; this example targets a Raspberry Pi with a 64-bit OS:

```bash
docker buildx build --platform linux/arm64 --load -t ghcr.io/japoch/sogo:local-test .
```

### Releases with GitHub Actions

Prepare a release PR with a new `VERSION` in `.env` and a matching `## [VERSION] - YYYY-MM-DD` section in `CHANGELOG.md`. Move only the included changes from `Unreleased`; this section becomes the release notes.

| Trigger | Build | Publish to GHCR | GitHub release |
| --- | --- | --- | --- |
| Relevant push to `main`, or manual `v*` tag matching `.env` | All three platforms | Yes | Yes |
| Relevant pull request to `main` or `release/**` | AMD64 | No | No |
| Manual workflow run | Selected `build_platforms` (default: all three) | Only with `publish_image: true` | No |

The [workflow's path filters](.github/workflows/docker-image.yml) select changes to build inputs and publishing helpers. Documentation-only and Compose-only changes do not trigger builds or require a version bump. Tag pushes bypass these filters.

The release sequence is **merge → build → publish → verify → tag and release**. Images use only the complete version, without `latest`, major, or minor aliases. After checking the manifest digest, platforms, and version/revision labels, the workflow creates `v<VERSION>` at the built commit and includes the image digest in the release. Versions such as `1.3.0-rc.1` produce prereleases. Builds reuse the GitHub Actions layer cache.

The release job uses `GITHUB_TOKEN` with `contents: write`; repository rules must allow it to create `v*` tags. These tags [do not trigger another workflow run](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow), avoiding a second build. No manual tagging or additional PAT is needed.

All publishing runs reject existing tags pointing to another commit and images with different version/revision labels or platforms. Use a new version for changed build inputs; existing tags and images are never replaced.

If attestation or release creation fails after publication, rerun the failed jobs in the original push run. Rerunning all jobs also reuses a matching image without rebuilding, completes a missing release, and leaves an existing matching release unchanged. Draft or inconsistent releases require manual review. Authentication errors and incomplete manifests stop the run. If an existing release's image was removed, publish a new version.

Check publishing safeguards and the shared GHCR reader locally with `node --test .github/scripts/test_release_image.cjs .github/scripts/test_delete_old_packages.cjs`.

### Publish locally

Create a personal access token (classic) with `write:packages` and save it in the ignored `.ghcr-token` file. For authenticated pulls only, `read:packages` is sufficient; see [GHCR authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry). Replace `GITHUB_USERNAME` with your username.

Run in Bash with a Buildx builder supporting the target platforms:

```bash
docker login ghcr.io --username GITHUB_USERNAME --password-stdin < .ghcr-token
source .env
docker buildx create --name sogo-builder --driver docker-container --use # once
docker buildx build --platform "$BUILD_PLATFORMS" -t "ghcr.io/japoch/sogo:$VERSION" --push .
docker logout ghcr.io
```

On a Linux builder, cross-platform builds may require [QEMU setup](https://docs.docker.com/build/building/multi-platform/#qemu). GitHub Actions configures it automatically.

## Usage

### Container image cleanup

Run **Delete old Docker images** manually. It previews candidates by default (`dry_run: true`); set `dry_run: false` to delete them. `keep_versions: 2` retains the two newest release-only versions by creation date. `min_age_hours: 168` protects versions created or updated within the last seven days (minimum setting: 24 hours).

The workflow verifies GHCR manifests before selecting older release-only versions and untagged orphans. Tagged images and recent uploads protect their referenced platform manifests, nested indexes, and attestations. Versions with aliases such as `latest` or `main` are never deleted. Keep a protected alias for images used only by digest; digest-only consumers cannot be detected.

At most 100 releases and orphans are deleted per run, with orphaned parents removed before their dependencies. Children of a release deleted in this run become eligible on a subsequent run. Cyclic references are retained. Orphaned indexes may be removed even if some children are already absent from both GHCR and the package inventory; missing children of protected images stop cleanup. The summary separates release and orphan candidates and reports protected and deferred versions.

Publishing, release verification, and cleanup share a GitHub Actions concurrency group. Keep external publishers idle during these operations: the lock covers only this repository's workflows. Cleanup rechecks the package inventory before each deletion and aborts on changes, unreadable manifests, or unsupported formats; registry reads and deletion are not atomic.

The repository's `GITHUB_TOKEN` needs **Admin** access to the container package under **Package settings → Manage Actions access**, in addition to the workflow's `packages: write` permission. See [GitHub's package deletion permissions](https://docs.github.com/en/packages/learn-github-packages/deleting-and-restoring-a-package).

### User management

Set the user details, then run the required command:

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

If session writes fail with `Data too long for column 'c_value' at row 1`, enlarge the session column to accommodate longer cookies ([SOGo issue #5491](https://bugs.sogo.nu/view.php?id=5491)):

```sql
ALTER TABLE sogo_sessions_folder MODIFY c_value VARCHAR(4096) NOT NULL;
```
