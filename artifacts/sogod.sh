#!/bin/sh
set -eu

# Refresh resources shared with the reverse proxy on each start.
if [ -d /var/lib/sogo-web-resources ]; then
    cp -a /usr/local/lib/GNUstep/SOGo/. /var/lib/sogo-web-resources/
fi

# Run memcached in background
/etc/init.d/memcached start

# Run SOGo in foreground
exec sudo -u sogo /usr/local/sbin/sogod -WOPort 0.0.0.0:20000 -WONoDetach YES -WOPidFile /var/run/sogo/sogo.pid -WOLogFile -
