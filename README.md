# SOGo

[![Docker Image CI](https://github.com/japoch/SOGo/actions/workflows/docker-image.yml/badge.svg)](https://github.com/japoch/SOGo/actions/workflows/docker-image.yml)
[![Codacy Security Scan](https://github.com/japoch/SOGo/actions/workflows/codacy.yml/badge.svg)](https://github.com/japoch/SOGo/actions/workflows/codacy.yml)

## Requirements
- Docker >19.03.0 Beta 3 with BuildX plugin with the full support of the features provided by [Moby BuildKit builder toolkit](https://github.com/moby/buildkit).

## Build and Push
```powershell
docker login
docker buildx create --name testbuilder --use
docker buildx build --platform linux/amd64,linux/arm/v7 -t japoch/docker-sogo-raspbian --push .
```

## Docker Images
[SOGo](https://hub.docker.com/repository/docker/japoch/docker-sogo-raspbian)

[Database](https://hub.docker.com/r/linuxserver/mariadb)

Systems:
- linux/amd64 
- linux/arm/v7

## Configuration
[SOGo Installation and Configuration Guide](https://www.sogo.nu/files/docs/SOGoInstallationGuide.html)
