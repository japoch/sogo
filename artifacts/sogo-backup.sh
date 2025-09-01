#!/bin/bash
set -uo pipefail

PROGNAME="$(basename $0)"
BACKUP_DIR="${BACKUP_DIR:-~sogo/backups}"
SOGO_TOOL="/usr/sbin/sogo-tool"
DAYS_TO_KEEP="${DAYS_TO_KEEP:-30}"
DATE="$(date +%F_%H%M)"
LOG="logger -t $PROGNAME -p daemon.info"

# log to stdout if on a tty
tty -s && LOG="cat -"

function initChecks {
  if [ ! -d "$BACKUP_DIR" ]; then
    if $(mkdir --mode=700 "$BACKUP_DIR"); then
  	  echo "BACKUP_DIR doesn't exist and couldn't create it, aborting ($BACKUP_DIR)" | $LOG
  	  exit 1
    fi
  fi

  if [ ! -w "$BACKUP_DIR" ]; then
    echo "$BACKUP_DIR not writable. Aborting" | $LOG
    exit 1
  fi
}

function removeOldBackups {
  if [ -n "$DRYRUN" ]; then
    RM="echo \"not deleted\""
  else
    RM="rm -rf"
  fi
  
  echo "Deleting old backups..." | $LOG
  find ${BACKUP_DIR}/ -maxdepth 1 -type d -iname "sogo-*" -mtime "+$DAYS_TO_KEEP" -ls -exec $RM {} \; 2>&1 | $LOG
  echo "Done deleting old backups." | $LOG
}


function dumpit {
  if $(mkdir --mode=700 "$BACKUP_DIR/sogo-${DATE}" 2>&1 | $LOG); then
    exit 1
  fi
  $SOGO_TOOL backup "$BACKUP_DIR/sogo-${DATE}/" ALL 2>&1 | $LOG
  RC=$?
  if [ $RC -ne 0 ]; then
    echo -e "FAILED, error while dumping sogo data" | $LOG
    exit $RC
  else
    echo -e "OK: dumped sogo data" | $LOG
  fi
}

echo "$PROGNAME starting" | $LOG
initChecks
dumpit
removeOldBackups
echo "$PROGNAME exiting" | $LOG

