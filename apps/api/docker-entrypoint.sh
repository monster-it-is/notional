#!/bin/sh
set -eu
node node_modules/@notional/db/dist/migrate-entry.js
exec node dist/server.js
