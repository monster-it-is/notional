#!/bin/sh
set -eu
node node_modules/@notional/db/dist/migrate-entry.js
unset MIGRATION_DATABASE_URL
exec node dist/server.js
