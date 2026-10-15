# Repository guidance

## Scope and working style

These instructions apply throughout this repository. Follow the user's requested scope and preserve existing local changes, including temporary version overrides in `.env`.

- Respond in the user's language; keep repository documentation, code comments, and commit messages in English.
- Make focused changes and follow the surrounding file's style. Avoid unrelated dependency updates or formatting changes.
- Inspect the current branch and diff before editing or committing. Stage specific files so local deployment settings are not accidentally committed.
- Commit, push, merge, publish images, or delete packages only within the user's authorized scope. Existing authorization does not need to be requested again.
- Keep operational instructions in [README.md](README.md). Add user-visible changes under `Unreleased` in [CHANGELOG.md](CHANGELOG.md); move only changes included in a release into its version section.

## Project map

This repository packages SOGo rather than maintaining its upstream application source.

| Path | Purpose |
| --- | --- |
| `Dockerfile` | Builds SOPE and SOGo from source on Debian and assembles the runtime image |
| `versions.yaml` | Upstream SOPE and SOGo Git tags; these differ from the container release version |
| `.env` | Tracked Compose defaults, container `VERSION`, and local `BUILD_PLATFORMS` |
| `docker-compose.yaml` | SOGo, MariaDB, Dovecot, and phpMyAdmin services and persistent storage |
| `sogo-conf/`, `nginx-conf/` | Application and proxy configuration, also mounted by Compose |
| `artifacts/` | Startup, backup, user-management, cron, and service files; consult the Dockerfile for files actually copied into the image |
| `.github/workflows/` | Image publishing, security scans, and manual package cleanup |
| `.github/scripts/` | SARIF normalization and package-cleanup helpers with regression tests |
| `.codacy/` | Codacy CLI bootstrap and pinned scanner configuration |

## Container and release constraints

- Keep release targets consistent between `.env` and both platform defaults in `docker-image.yml`: `linux/amd64`, `linux/arm/v7`, and `linux/arm64`. `linux/arm/v8` is not ARM64.
- Raspberry Pi 3 and 4 can use ARM64 with a 64-bit OS. Check the exact tags of all third-party Compose images before claiming that the entire stack supports a platform. A successful SOGo build alone is insufficient.
- Compose currently defaults the database, mail, and phpMyAdmin services to AMD64 via `PLATFORM`. Account for that setting when diagnosing Raspberry Pi deployments.
- Do not enable Compose `init: true` for the LinuxServer MariaDB or phpMyAdmin images: their integrated s6 init must be PID 1. Evaluate other images separately.
- Preserve persistent mounts, health checks, and dependency ordering when editing Compose. Avoid deleting data or volumes during troubleshooting; never use `docker compose down -v` as a routine reset.
- Publish only the complete `.env` version as the image tag. Do not introduce `latest`, major, or minor aliases. A release Git tag must be `v` followed by that version.
- Preserve Docker workflow path filters. Compose-only and documentation-only changes should not trigger an image build on PRs or merges. Do not bump `.env` merely to deliver a Compose or documentation fix.
- PR image builds test AMD64 without publishing. Manual builds default to `publish_image: false`; relevant pushes to `main` and matching release-tag pushes publish. Tag pushes bypass path filters.
- A changed `VERSION` does not mean an image exists yet. For release verification, check the run for the actual commit, then the GHCR manifest, platform list, version label, and revision label. Report pending builds as pending.

## Workflows and helper scripts

- Pin third-party actions to full commit SHAs with a version comment. Verify the upstream release and supported runtime when updating a pin. Keep permissions scoped to each job's needs.
- Codacy uses Opengrep, Pylint, and Trivy. Keep its CLI version, scanner configuration, and workflow matrix compatible. When renaming a scanner, check required code-scanning tool names in repository rules; do not silently weaken those rules.
- Scanner failures must fail CI. SARIF normalization must retain findings and reject failed or empty scanner runs rather than manufacturing a successful report. A valid scan with zero findings is acceptable.
- Package cleanup must default to a preview. Preserve referenced manifests and attestations, recent uploads, and versions with alias tags. Delete untagged entries only after inspecting the manifest graph and applying the grace period; untagged does not mean unused in a multiarch image.
- Keep cleanup and publishing in the same concurrency group. External publishers must remain idle during deletion; inventory rechecks cannot make registry reads and deletes atomic.
- Preserve cleanup retention, the per-run deletion cap, candidate revalidation, and failure propagation. Test deletion logic with mocked API calls, not live package deletion.

## Validation

Run checks appropriate to the changed files from the repository root. Documentation-only changes need a diff and link review, not a Docker build.

| Change | Check |
| --- | --- |
| Any tracked edits | `git diff --check` |
| Compose or `.env` | `docker compose config --quiet` |
| GitHub workflows | `actionlint .github/workflows/*.yml` |
| SARIF helper | `python3 -m unittest discover -s .github/scripts -p 'test_*.py'` |
| Package cleanup helper | `node --test .github/scripts/test_delete_old_packages.cjs` |
| Shell scripts | Use `sh -n` or `bash -n` according to the shebang; use ShellCheck when available |

The Python and Node tests use their standard libraries. State when a required tool is unavailable rather than claiming its check passed. Add regression coverage for changed helper behavior, especially failure handling and deletion safeguards.

For Dockerfile or startup changes, start with a single-platform Buildx build using `--load` and a local test tag. Choose the platform for the test host. Full emulated multiarch builds are expensive; run them when needed to verify release or architecture changes. Syntax checks and successful builds do not establish runtime health: inspect service state and relevant logs when testing startup fixes.

## Credentials and local state

- `.github-token` and `.ghcr-token` are local credentials. Never print, commit, or embed them in commands, URLs, logs, or documentation. Use them only for authorized access to the intended service.
- Avoid printing Git remote URLs or expanded Compose configuration: these can contain credentials. Use `docker compose config --quiet` or `--images` for routine validation.
- Treat `db-root/`, `phpmyadmin-root/`, `mail-root/`, `backup/`, certificates, and Docker volumes as local deployment data. Exclude them from broad searches and commits unless the task specifically concerns them.
- `.gitignore` and `.dockerignore` serve different purposes. Check the build context before adding broad `COPY` instructions; credentials and runtime data must not enter images or uploaded build contexts.
- Report what changed, which checks actually ran, and any remaining limitation. Do not equate a green workflow with a vulnerability-free application or a successful deployment.
