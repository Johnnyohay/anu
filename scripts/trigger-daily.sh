#!/bin/bash
# Starts ANU's "Daily brief" workflow on GitHub unless today's brief is already published.
# Run by launchd (com.anu.daily) at 9:00 local time, because GitHub's own cron often starts hours late.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
today=$(TZ=America/New_York date +%F)
if curl -sfL https://johnnyohay.github.io/anu/api/v1/briefs.json | grep -q "\"date\":\"$today\""; then
  echo "$(date) brief for $today already published"; exit 0
fi
gh workflow run "Daily brief" -R Johnnyohay/anu && echo "$(date) started Daily brief for $today"
