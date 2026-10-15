# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Remove Compose's additional init process from MariaDB and phpMyAdmin so their s6 init can run as PID 1.

## [1.2.0] - 2026-10-15

### Changed

- Set the Compose image version to `1.2.0` in `.env`.
- Replaced the ARMv8 32-bit build target with ARM64, retaining ARMv7 and AMD64; simplified the README and documented Raspberry Pi OS requirements.
- Published Docker images only under the complete version from `.env`, validating matching Git release tags.
- Added native workflow path filters, cached build layers, and AMD64-only pull request builds to reduce CI work.
- Made publishing opt-in for manual Docker workflow runs with the `publish_image` switch.
- Enabled CodeQL and Codacy scans on `feature/**` branches.
- Limited package cleanup to older release-only image versions, preserving untagged manifests and aliases. Added configurable retention, a default preview mode, and cleanup summaries.

### Fixed

- Updated deprecated GitHub Actions to Node.js 24-compatible versions and CodeQL Action v4.
- Fixed Codacy execution and SARIF uploads by replacing Semgrep with Opengrep, updating Trivy, and validating and normalizing reports.

## [1.1.0]

### Added

- Added a documented Git-tag release flow for versioned Docker images.
- Published Docker images with exact, `major.minor`, and major-version tags.

### Changed

- Set the Compose image version to `1.1.0` in `.env`.

## [1.0.0]

### Added

- Added `.dockerignore` rules to reduce the Docker build context.
- Added multi-platform and platform-specific local build instructions.

### Changed

- Updated SOGo and SOPE to 5.12.12.
- Improved the Docker build with parallel compilation and package-cache cleanup.
- Updated Docker Compose with configurable service settings, database health checks,
  startup ordering, init processes, and bounded container logs.
- Disabled the scheduled CodeQL workflow.

## [0.0.9]

### Added

- Added a CodeQL workflow and Docker image publishing on tag pushes.

### Changed

- Updated SOGo to 5.12.3 and updated the Docker Compose configuration.

### Security

- Fixed CodeQL findings in `sogo-backup.sh`.

## [0.0.8]

### Added

- Added a workflow to delete old container packages.

### Changed

- Updated SOGo to 5.12.2 and made the Docker platform configurable.
- Updated the documentation.

## [0.0.7]

### Added

- Added the SOGo administrator database table.

### Changed

- Updated the documentation.

## [0.0.6]

### Changed

- Configured the target platform in Docker Compose.

## [0.0.5]

### Added

- Added multi-platform Docker image builds, including ARM support.

### Changed

- Updated SOGo to 5.11.2 and made Docker Compose settings environment-configurable.
- Changed the SOGo TCP port.

### Fixed

- Fixed script access permissions.

## [0.0.4]

### Changed

- Updated SOGo to 5.10.0.

[Unreleased]: https://github.com/japoch/SOGo/compare/v1.2.0...main
[1.2.0]: https://github.com/japoch/SOGo/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/japoch/SOGo/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/japoch/SOGo/compare/v0.0.9...v1.0.0
[0.0.9]: https://github.com/japoch/SOGo/compare/0.0.8...v0.0.9
[0.0.8]: https://github.com/japoch/SOGo/compare/0.0.7...0.0.8
[0.0.7]: https://github.com/japoch/SOGo/compare/0.0.6...0.0.7
[0.0.6]: https://github.com/japoch/SOGo/compare/0.0.5...0.0.6
[0.0.5]: https://github.com/japoch/SOGo/compare/0.0.4...0.0.5
[0.0.4]: https://github.com/japoch/SOGo/compare/ad621444268ae4e9602d3a5a3e9904cc2c7ae895...0.0.4
