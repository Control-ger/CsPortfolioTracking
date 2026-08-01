#!/bin/sh
set -e

# Runs as root before any writer starts.
#
# Two processes append to the same log file with different uids: Apache/PHP as
# www-data, the supervisord crons as root. Whoever creates app.log first owns
# it — and when that is the root cron, every web request silently loses its
# events, because FileSink appends with a silenced @file_put_contents. The
# result is a log that keeps growing and looks healthy while containing no
# request-scoped entry at all.
#
# The build-time chown alone cannot fix this: a bind-mounted host directory
# overlays the image's ownership, so the correction has to happen here, at
# container start, against whatever is actually mounted.
#
# Owning the file as www-data works for both writers: www-data writes as the
# owner, and root ignores file permissions anyway.
mkdir -p /var/www/html/logs
touch /var/www/html/logs/app.log
chown www-data:www-data /var/www/html/logs /var/www/html/logs/app.log

exec "$@"
