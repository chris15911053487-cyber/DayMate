#!/bin/sh
# 每天凌晨 3 点（容器时区）用 pg_dump 备份一次，保留 BACKUP_KEEP_DAYS 天（默认 14）。
# 恢复：gunzip -c /backups/daymate-xxx.sql.gz | psql -h db -U daymate daymate
set -eu
KEEP="${BACKUP_KEEP_DAYS:-14}"
while true; do
  now=$(date +%s)
  next=$(date -d "tomorrow 03:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$(date +%H)" -lt 3 ] && next=$(date -d "today 03:00" +%s)
  sleep $((next - now))
  file="/backups/daymate-$(date +%Y%m%d-%H%M%S).sql.gz"
  if pg_dump -h db -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$file"; then
    echo "备份完成：$file"
  else
    echo "备份失败" >&2
    rm -f "$file"
  fi
  find /backups -name 'daymate-*.sql.gz' -mtime +"$KEEP" -delete
done
