# Repository guidance

## Working style

- Preserve local changes, including `.env` overrides. Inspect the branch and diff before editing; stage specific files.
- Respond in the user's language; write documentation, comments, and commits in English. Keep changes scoped and consistent with existing style.
- Commit, push, merge, publish images, or delete packages only when authorized; do not ask again for existing authorization.
- Use rebase merge or squash merge for linear history. Create merge commits only on explicit request.
- Keep operational instructions in [README.md](README.md) and user-visible changes under `Unreleased` in [CHANGELOG.md](CHANGELOG.md). Move only released changes into version sections.

## Release shortcut

Treat "Prepare release X.Y.Z" (or the equivalent in the user's language) as authorization to create or reuse `release/X.Y.Z`, include the agreed changes, update `.env` and dated changelog notes, run relevant checks, commit, push, and create or update a PR against `main`. Preserve unrelated local changes and report the PR link and CI status. Use the existing origin token for GitHub access without exposing it. Stop before merging unless requested; when authorized and required CI passes, use rebase merge (or squash if requested), then monitor publication and verify the release as described below.

## Project map

This repository packages SOGo, not upstream application source.

| Path | Purpose |
| --- | --- |
| `Dockerfile`, `versions.yaml` | Debian image build and upstream SOPE/SOGo tags |
| `.env`, `docker-compose.yaml` | Container version, platforms, stack defaults and storage |
| `sogo-conf/`, `nginx-conf/` | Application/proxy configuration, also mounted by Compose |
| `artifacts/` | Startup, backup, user, cron and service files; Dockerfile selects image contents |
| `.github/workflows/`, `.github/scripts/` | Publishing, scans, cleanup, helpers and tests |
| `.codacy/` | Codacy CLI bootstrap and pinned scanners |

## Containers and releases

- Align `.env` and both `docker-image.yml` platform defaults: `linux/amd64,linux/arm/v7,linux/arm64`. ARM64 requires a 64-bit OS; `linux/arm/v8` is not ARM64.
- Compose defaults database, mail and phpMyAdmin to AMD64 via `PLATFORM`. Verify their exact image tags before claiming whole-stack platform support.
- Preserve mounts, health checks and dependency ordering. Never use `docker compose down -v` as a routine reset. Do not add `init: true` to LinuxServer MariaDB or phpMyAdmin: s6 must be PID 1.
- Publish the complete `.env` `VERSION`; Git release tags are `v<VERSION>`. Promote `latest` separately to the verified stable digest, including reused images; never downgrade it or use prereleases. No major/minor aliases.
- Preserve path filters: documentation/Compose-only changes must not trigger image builds or version bumps unless explicitly requested. Tag pushes bypass filters.
- PR builds test AMD64 without publishing. Manual runs default to `publish_image: false`; relevant `main` and matching release-tag pushes publish.

## CI and cleanup

- Pin third-party actions to full SHAs with version comments; verify upstream releases/runtimes when updating. Scope permissions per job.
- Keep Codacy CLI, configuration and matrix compatible with Opengrep, Pylint and Trivy. Preserve required code-scanning tool names and fail CI on scanner errors.
- SARIF normalization must retain findings and reject failed or empty runs; valid zero-finding scans are acceptable.
- Cleanup defaults to preview. Inspect manifest references and enforce the grace period before deleting untagged entries. Protect referenced manifests/attestations, recent uploads and alias-tagged versions.
- Preserve retention, deletion caps, candidate revalidation and failure propagation. Serialize cleanup and publishing in one concurrency group; keep external publishers idle during deletion. Registry reads and deletes are not atomic.

## Validation

Run relevant checks from the repository root. Documentation-only edits need diff/link review, not builds.

| Change | Check |
| --- | --- |
| Any tracked edit | `git diff --check` |
| Compose or `.env` | `docker compose config --quiet` |
| Workflows | `actionlint .github/workflows/*.yml` |
| SARIF helpers | `python3 -m unittest discover -s .github/scripts -p 'test_*.py'` |
| Publishing/cleanup helpers | `node --test .github/scripts/test_release_image.cjs .github/scripts/test_delete_old_packages.cjs` |
| Shell scripts | `sh -n` or `bash -n` per shebang; ShellCheck when available |

- Use standard-library Python/Node tests for changed helper behavior, especially failures and deletion safeguards. Mock deletion APIs.
- For Dockerfile/startup changes, build with Buildx `--load`, a local test tag and the test host's platform. Use emulated multiarch builds when release/architecture verification requires them. Check service state and logs for startup fixes.
- Verify releases against the actual commit's workflow, GHCR digest, platforms and version/revision labels. Report pending builds, checks run, unavailable tools and limitations; build/CI success alone proves neither runtime health nor absence of vulnerabilities.

## Credentials and local data

- Use credentials only for authorized access to their intended services. Never expose or commit tokens, credential-bearing remote URLs, or expanded Compose configuration; use `config --quiet` or `--images`.
- Exclude deployment data (`db-root/`, `phpmyadmin-root/`, `mail-root/`, `backup/`, certificates and volumes) from broad searches and commits unless explicitly in scope.
- Check `.gitignore` and `.dockerignore` separately before broad `COPY` changes: credentials and runtime data must not enter images or uploaded build contexts.
