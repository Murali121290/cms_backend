#!/bin/bash
set -e

echo "Running database migrations..."
{ alembic upgrade head; } || {
    echo "Migration failed — resyncing alembic version to consolidated baseline (0001_initial_schema)..."
    alembic stamp --purge 0001_initial_schema
    alembic upgrade head
}

# Auto-seed only when explicitly requested via SEED_DB=true
# Usage: docker compose run --rm -e SEED_DB=true backend
# or set SEED_DB=true in .env for first-time deploy
if [ "${SEED_DB}" = "true" ]; then
    echo "Seeding database..."
    python seed.py
    echo "Seeding complete."
fi

echo "Starting application..."
exec "$@"
