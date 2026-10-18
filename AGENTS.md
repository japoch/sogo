# Repository guidance

## Scope and working style

Applies repository-wide. Preserve local changes, including temporary `.env` version overrides.

- Respond in the user's language; keep repository documentation, code comments, and commit messages in English.
- Stay within the requested scope and surrounding style; avoid unrelated dependency or formatting changes.
- Inspect the branch and diff before editing or committing. Stage specific files to avoid committing local deployment settings accidentally.
- Commit, push, merge, publish images, or delete packages only as authorized; do not request existing authorization again.
- Keep operational instructions in [README.md](README.md) and user-visible changes under `Unreleased` in [CHANGELOG.md](CHANGELOG.md). Move only changes included in a release into its version section.

## Project map

This repository packages SOGo; it does not maintain upstream application source.

| Path | Purpose |
| --- | --- |
| `Dockerfile` | Debian-based SOPE/SOGo source build and runtime image |
| `versions.yaml` | Upstream Git tags, separate from the container version |
| `.env` | Tracked Compose defaults, `VERSION`, and local `BUILD_PLATFORMS` |
| `docker-compose.yaml` | SOGo, MariaDB, Dovecot, phpMyAdmin, and persistent storage |
| `sogo-conf/`, `nginx-conf/` | Application/proxy configuration, also mounted by Compose |
| `artifacts/` | Startup, backup, user-management, cron, and service files; the Dockerfile determines which enter the image |
| `.github/workflows/` | Image publishing, security scans, and manual package cleanup |
| `.github/scripts/` | SARIF, release, and package-cleanup helpers and regression tests |
| `.codacy/` | Codacy CLI bootstrap and pinned scanner configuration |

## Container and release constraints

- Keep `.env` and both platform defaults in `docker-image.yml` aligned: `linux/amd64`, `linux/arm/v7`, `linux/arm64`. `linux/arm/v8` is not ARM64.
- Pi 3/4 support ARM64 with a 64-bit OS, but Compose defaults database, mail, and phpMyAdmin to AMD64 via `PLATFORM`. Verify exact third-party image tags before claiming whole-stack platform support; a SOGo build alone is insufficient.
- Do not enable Compose `init: true` for LinuxServer MariaDB or phpMyAdmin: s6 must be PID 1. Evaluate other images separately.
- Preserve mounts, health checks, and dependency ordering. Avoid deleting data or volumes during troubleshooting; never use `docker compose down -v` as a routine reset.
- Publish the complete `.env` `VERSION` and update `latest` separately to the verified stable image digest, including reused images. Never move `latest` to a prerelease or an older version; do not publish major or minor aliases. Release Git tags must be `v<VERSION>`.
- Preserve Docker path filters: documentation-only and Compose-only changes must not trigger PR/merge image builds. Do not bump `.env` for these changes.
- PR builds test AMD64 without publishing; manual builds default to `publish_image: false`. Relevant `main` pushes and matching release-tag pushes publish; tag pushes bypass path filters.

## Workflows and helper scripts

- Pin third-party actions to full commit SHAs with version comments; verify upstream releases and runtimes when updating. Scope permissions per job.
- Keep Codacy's CLI, scanner configuration, and matrix compatible with Opengrep, Pylint, and Trivy. Scanner renames must respect required code-scanning tool names in repository rules; never silently weaken them.
- Scanner failures must fail CI. SARIF normalization must retain findings and reject failed or empty runs; valid scans with zero findings are acceptable.
- Cleanup defaults to preview. Preserve referenced manifests/attestations, recent uploads, and alias-tagged versions. Inspect the manifest graph and apply the grace period before deleting untagged entries; untagged does not mean unused.
- Preserve retention, per-run deletion caps, candidate revalidation, and failure propagation. Keep cleanup and publishing in one concurrency group; external publishers must remain idle during deletion. Registry reads and deletes are not atomic.

## Validation

Run relevant checks from the repository root. Documentation-only edits need diff/link review, not a Docker build.

| Change | Check |
| --- | --- |
| Any tracked edits | `git diff --check` |
| Compose or `.env` | `docker compose config --quiet` |
| GitHub workflows | `actionlint .github/workflows/*.yml` |
| SARIF helper | `python3 -m unittest discover -s .github/scripts -p 'test_*.py'` |
| Package cleanup helper | `node --test .github/scripts/test_delete_old_packages.cjs` |
| Shell scripts | `sh -n` or `bash -n` per shebang; ShellCheck when available |

- Python/Node tests use standard libraries. Cover changed helper behavior, especially failures and deletion safeguards; mock deletion APIs instead of deleting live packages.
- For Dockerfile/startup changes, start with Buildx `--load`, a local test tag, and the test host's platform. Run expensive emulated multiarch builds when release/architecture verification requires them. For startup fixes, inspect service state and logs; build success does not establish runtime health.
- Verify releases against the actual commit's workflow run, GHCR manifest, platforms, and version/revision labels. A changed `VERSION` does not prove publication; report pending builds as pending.
- Report changes, checks actually run, unavailable tools, and limitations. Green CI does not prove a vulnerability-free application or successful deployment.

## Credentials and local state

- Use `.github-token` and `.ghcr-token` only for authorized access to their intended services. Never print, commit, or embed credentials in commands, URLs, logs, or documentation.
- Do not print Git remote URLs or expanded Compose configuration, which may contain credentials. Use `docker compose config --quiet` or `--images`.
- Exclude deployment data (`db-root/`, `phpmyadmin-root/`, `mail-root/`, `backup/`, certificates, Docker volumes) from broad searches and commits unless explicitly in scope.
- `.gitignore` and `.dockerignore` serve different purposes. Before broad `COPY` changes, check that credentials and runtime data cannot enter images or uploaded build contexts.
