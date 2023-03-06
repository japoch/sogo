#!/bin/sh
set -eu

# Run nginx in background
echo "Starting nginx."
/usr/sbin/nginx -g 'daemon on; master_process on;'

# Run memcached in background
/etc/init.d/memcached start

# Run SOGo in foreground
exec sudo -u sogo /usr/local/sbin/sogod -WONoDetach YES -WOWorkersCount 1 -WOPidFile /var/run/sogo/sogo.pid -WOLogFile -
