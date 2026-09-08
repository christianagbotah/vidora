#!/usr/bin/env bash
# Validate Vidora's production code/media/backup directory topology.
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 PROJECT_DIR GENERATED_DIR BACKUP_DIR" >&2
  exit 2
fi

PROJECT_DIR="$1"
GENERATED_DIR="$2"
BACKUP_DIR="$3"

for value in "$PROJECT_DIR" "$GENERATED_DIR" "$BACKUP_DIR"; do
  if [[ "$value" != /* ]]; then
    echo "FATAL: storage topology paths must be absolute: $value" >&2
    exit 1
  fi
done

PROJECT_REAL="$(realpath -m -- "$PROJECT_DIR")"
GENERATED_REAL="$(realpath -m -- "$GENERATED_DIR")"
BACKUP_REAL="$(realpath -m -- "$BACKUP_DIR")"

same_or_descendant() {
  local child="$1"
  local parent="$2"
  [[ "$child" == "$parent" || "$child" == "$parent"/* ]]
}

if [[ "$GENERATED_REAL" == "/" ]]; then
  echo "FATAL: GENERATED_DIR cannot be filesystem root" >&2
  exit 1
fi
if [[ "$BACKUP_REAL" == "/" ]]; then
  echo "FATAL: BACKUP_DIR cannot be filesystem root" >&2
  exit 1
fi

# Generated media may live below the project checkout (the documented default
# does), but never at the checkout root or under the disposable Next build tree.
if [[ "$GENERATED_REAL" == "$PROJECT_REAL" ]]; then
  echo "FATAL: GENERATED_DIR cannot be the Vidora project root" >&2
  exit 1
fi
if same_or_descendant "$GENERATED_REAL" "$PROJECT_REAL/.next"; then
  echo "FATAL: GENERATED_DIR must live outside the disposable .next tree" >&2
  exit 1
fi

# Recovery archives must live outside the Git checkout. Otherwise creating a
# backup can dirty production immediately after the pre-deploy cleanliness gate,
# and future pulls/rollbacks can interact with recovery data.
if same_or_descendant "$BACKUP_REAL" "$PROJECT_REAL"; then
  echo "FATAL: BACKUP_DIR must live outside the Vidora project checkout" >&2
  exit 1
fi

# Neither recovery storage nor live generated media may contain the other.
# This prevents recursive/self-referential tar archives and keeps destructive
# rollback media cleanup away from recovery artifacts.
if same_or_descendant "$BACKUP_REAL" "$GENERATED_REAL" || \
   same_or_descendant "$GENERATED_REAL" "$BACKUP_REAL"; then
  echo "FATAL: GENERATED_DIR and BACKUP_DIR must not overlap or contain one another" >&2
  exit 1
fi

echo "Storage path topology: OK"
