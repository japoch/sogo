# SOGo for Docker

[![Docker Image CI](https://github.com/japoch/SOGo/actions/workflows/docker-image.yml/badge.svg)](https://github.com/japoch/SOGo/actions/workflows/docker-image.yml)
[![Codacy Security Scan](https://github.com/japoch/SOGo/actions/workflows/codacy.yml/badge.svg)](https://github.com/japoch/SOGo/actions/workflows/codacy.yml)

[SOGo](http://www.sogo.nu) is fully supported and trusted groupware server with a focus on scalability and open standards. SOGo is released under the GNU GPL/LGPL v2 and above. 

This Dockerfile packages SOGo compiled from the sources from [Alinto/sogo](https://github.com/Alinto/sogo) together with [NGINX](https://www.nginx.com/) and [memcached](https://memcached.org/).

## Setup

Run the Docker container with

    docker run --rm -name sogo japoch/sogo:latest

We provide a full functional setup with Docker-Compose.

    docker-compose up -d

Additional you run the compose file as an systemd service.

    cp ./artifacts/sogo-docker.service /etc/systemd/system
    systemctl start sogo-docker.service && systemctl enable sogo-docker.service

### Generate self-signed SSL key for Dovecot
openssl req -newkey rsa:4096 -sha512 -x509 -days 365 -nodes -keyout dovecot-root/certs/dovecot_cert/smtp.key -out dovecot-root/certs/dovecot_cert/smtp-key.pem

### Database

A separate database is required, for example a MariaDB container as provided by the Docker image [linuxserver/mariadb](https://hub.docker.com/r/linuxserver/mariadb), but also any other database management system SOGo supports can be used. Follow the _Database Configuration_ chapter of the SOGo documentation on these steps, and modify the sogo.conf` file accordingly.

### memcached

As most users will not want to separate memcached, there is a built-in daemon.

### Sending Mail

For further details in MTA configuration including SMTP auth, refer to SOGo's documentation.

### NGINX and HTTPs

As already given above, the default NGINX configuration is already available under `artifacts/nginx.conf` and  `nginx-conf/sites-enabled/sogo-nginx.conf`. The container exposes HTTP (80), HTTPS (443), and 20000, the default port the SOGo daemon listens on. You can directly include the certificates within the container.

### Cron-Jobs: Backup, Session Timeout, Sieve

SOGo heavily relies on cron jobs for different purposes. The image provides SOGo's original cron file as `artifacts/sogo.cron`. The backup script is available and made executable at the location `/usr/local/share/doc/sogo/sogo-backup.sh`, so backup is fully functional after uncommenting the respective cron job and after rebuild the image.

### Further Configuration

Remember to start a reasonable number of worker processes matching to your needs (8 will not be enough for medium and larger instances):

    WOWorkersCount = 8;

All other configuration options have no special considerations.

## Build

### Requirements

Docker >19.03.0 Beta 3 with BuildX plugin with the full support of the features provided by [Moby BuildKit builder toolkit](https://github.com/moby/buildkit).

### Build and Push

Build the image for linux/amd64 and linux/arm/v7.

    docker buildx create --name testbuilder --use
    docker buildx build --platform linux/amd64,linux/arm/v7 -t japoch/sogo:latest -t japoch/sogo:$(<VERSION) --push .

## Usage

### Usermanagement

Preparation: Set the needed environment variables like this.
```bash
sogo_user='user.name'
sogo_pass='password'
sogo_name='User Name'
sogo_fqhn='localhost'
```

View the user table with `docker-compose exec db mysql -u sogo -ppassword -D sogo -e "SELECT * FROM sogo_view;"`

Insert a new user into SOGo with `docker-compose exec db mysql -u sogo -ppassword -D sogo -e "INSERT INTO sogo_view VALUES('$sogo_user', '$sogo_user', MD5('$sogo_pass'), '$sogo_name', '$sogo_user@$sogo_fqhn');"`

Update password with `docker-compose exec db mysql -u sogo -ppassword -D sogo -e "UPDATE sogo_view SET c_password=MD5('$sogo_pass') WHERE c_uid='$sogo_user';"`

Remove an user from SOGo with `docker-compose exec db mysql -u sogo -ppassword -D sogo -e "DELETE FROM sogo_view WHERE c_uid='$sogo_user'"`

### Backup / Restore

Preparation: Start an Bash shell from inside SOGo's Docker container with `docker-compose exec sogo bash`.

Create backup of all or of one single user with `sogo-tool backup /mnt/backup [ALL | username]`.

List content of backup with `sogo-tool restore -l /mnt/backup username`.

Restore parameters (signature, filters ....) with `sogo-tool restore -p /mnt/backup username`.

Restore the folders (calenders and contacts) of one user with `sogo-tool restore -f ALL /mnt/backup username`.

or use SOGos browser import/export function.
