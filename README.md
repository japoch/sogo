# SOGo for Docker

[![Docker Image CI](https://github.com/japoch/SOGo/actions/workflows/docker-image.yml/badge.svg)](https://github.com/japoch/SOGo/actions/workflows/docker-image.yml)
[![Codacy Security Scan](https://github.com/japoch/SOGo/actions/workflows/codacy.yml/badge.svg)](https://github.com/japoch/SOGo/actions/workflows/codacy.yml)
[![CodeQL Advanced](https://github.com/japoch/sogo/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/japoch/sogo/actions/workflows/codeql.yml)

[SOGo](http://www.sogo.nu) is an open-source groupware server licensed under GNU GPL/LGPL v2 and above. This image builds [SOGo](https://github.com/Alinto/sogo) and [SOPE](https://github.com/Alinto/sope) from source and includes NGINX and memcached.

Images are available on [GHCR](https://github.com/japoch/sogo/pkgs/container/sogo) for `linux/amd64`, `linux/arm/v7`, and `linux/arm/v8`. Tested on Raspberry Pi 4, Banana Pi, and WSL. A 64-bit OS (`aarch64`) is recommended for Raspberry Pi 4.

## Setup

Start the provided Docker Compose stack:

```bash
docker compose up -d
docker compose logs -f
```

To run the SOGo container separately (requires an external database):

```bash
docker run --rm --name sogo ghcr.io/japoch/sogo:1.1.0
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

Requires Docker with Buildx and [BuildKit](https://github.com/moby/buildkit) support. Source versions are defined in `versions.yaml`; release settings are in `.env`.

### Local builds

Build only the target platform for faster development, and use `--load` to test locally:

```bash
# Raspberry Pi 4 with a 64-bit OS
docker buildx build --platform linux/arm64 --load -t ghcr.io/japoch/sogo:local-test .

# x86_64 hosts
docker buildx build --platform linux/amd64 --load -t ghcr.io/japoch/sogo:local-test .
```

The Dockerfile already uses parallel compilation. Keep the build context small with `.dockerignore`.

### Registry authentication

For authenticated access to GHCR, create a personal access token (classic) under **GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)**. Use `read:packages` to pull and `write:packages` to publish. See [GitHub's authentication guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry).

Save only the token, without quotes, in `.ghcr-token` at the repository root. The file is excluded by `.gitignore`; do not commit or share it. Replace `GITHUB_USERNAME` below with your username.

```powershell
Get-Content -Raw .ghcr-token | docker login ghcr.io --username GITHUB_USERNAME --password-stdin
```

```bash
docker login ghcr.io --username GITHUB_USERNAME --password-stdin < .ghcr-token
```

Docker stores the credentials locally. Remove them with `docker logout ghcr.io`.

### Releases

Update `versions.yaml` and `.env`. Set `VERSION` in `.env` without the `v` prefix, then push a matching Git tag:

```bash
git tag -a v1.1.0 -m "Release v1.1.0"
git push origin v1.1.0
```

A `v*` tag triggers the GitHub Actions release build and must match `VERSION` in `.env`. The workflow publishes only the complete version, for example `ghcr.io/japoch/sogo:1.1.0` or `ghcr.io/japoch/sogo:1.1.0-rc.1`. Docker Compose selects the same version from `.env`.

Relevant pushes to `main` also publish `VERSION` from `.env`, replacing that image tag if it already exists. Manual workflow runs default to a build test; enable `publish_image` to publish to GHCR. Select the feature branch and desired `build_platforms` when testing. Pull requests only build an AMD64 test image. Published builds use all configured platforms, and GitHub Actions caches build layers between runs.

For a manual release, authenticate as described above and use `BUILD_PLATFORMS` from `.env` (default: `linux/amd64,linux/arm/v7,linux/arm/v8`).

PowerShell:

```powershell
Get-Content .env | ForEach-Object { if ($_ -match '^(.*?)=(.*)$') { $name = $matches[1]; $value = $matches[2]; [System.Environment]::SetEnvironmentVariable($name, $value, 'Process') } }
docker buildx create --name testbuilder --use
docker buildx build --platform $env:BUILD_PLATFORMS -t ghcr.io/japoch/sogo:$env:VERSION --push .
```

Bash:

```bash
source .env
docker buildx create --name testbuilder --use
docker buildx build --platform ${BUILD_PLATFORMS} -t ghcr.io/japoch/sogo:${VERSION} --push .
```

## Usage

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
