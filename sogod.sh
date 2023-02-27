#!/bin/sh
set -eu

# Run SOGo in foreground
exec /usr/local/sbin/sogod -WONoDetach YES -WOWorkersCount 3 -WOPidFile /var/run/sogo/sogo.pid -WOLogFile -
