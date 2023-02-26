# SOGo

## Requirements
- Docker >19.03.0 Beta 3 with BuildX plugin with the full support of the features provided by [Moby BuildKit builder toolkit](https://github.com/moby/buildkit).

## Build and Push
```powershell
docker login
docker buildx create --name testbuilder --use
docker buildx build --platform linux/amd64,linux/arm/v7 -t japoch/docker-sogo-raspbian --push .
```

## Docker Images
[Docker images at DockerHub](https://hub.docker.com/repository/docker/japoch/docker-sogo-raspbian)

Systems:
- linux/amd64 
- linux/arm/v7
