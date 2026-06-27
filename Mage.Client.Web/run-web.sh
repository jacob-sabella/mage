#!/usr/bin/env bash
# Build (if needed) and run the XMage web gateway.
#
# JBoss Remoting + Java serialization needs these --add-opens on Java 9+,
# otherwise login to any server fails with
#   "Unable to make private void java.io.ObjectOutputStream.clear() accessible".
#
# Usage:  ./run-web.sh [port]      (default 8090)
# Env:    MAGE_IMAGE_DIR  path to a desktop client's plugins/images cache (real card art)
set -euo pipefail

PORT="${1:-8090}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
MVN="${MVN:-mvn}"

cd "$ROOT"

# Build the gateway + its upstream modules and a runtime classpath file.
"$MVN" -q -Pweb-client -pl Mage.Client.Web -am install -DskipTests
"$MVN" -q -Pweb-client -pl Mage.Client.Web dependency:build-classpath \
  -Dmdep.outputFile="$HERE/target/cp.txt"

CP="$HERE/target/classes:$(cat "$HERE/target/cp.txt")"

OPENS=(
  --add-opens java.base/java.lang=ALL-UNNAMED
  --add-opens java.base/java.lang.reflect=ALL-UNNAMED
  --add-opens java.base/java.io=ALL-UNNAMED
  --add-opens java.base/java.net=ALL-UNNAMED
  --add-opens java.base/java.nio=ALL-UNNAMED
  --add-opens java.base/java.util=ALL-UNNAMED
  --add-opens java.base/java.util.concurrent=ALL-UNNAMED
  --add-opens java.base/java.util.concurrent.atomic=ALL-UNNAMED
  --add-opens java.base/java.text=ALL-UNNAMED
  --add-opens java.base/java.math=ALL-UNNAMED
  --add-opens java.base/sun.nio.ch=ALL-UNNAMED
  --add-opens java.desktop/java.awt=ALL-UNNAMED
  --add-opens java.desktop/java.awt.font=ALL-UNNAMED
  --add-opens java.desktop/sun.awt=ALL-UNNAMED
  --add-opens java.management/sun.management=ALL-UNNAMED
  --add-opens java.sql/java.sql=ALL-UNNAMED
)

echo "Starting XMage web client on http://localhost:$PORT"
exec java "${OPENS[@]}" -cp "$CP" mage.client.web.WebClientApp "$PORT"
