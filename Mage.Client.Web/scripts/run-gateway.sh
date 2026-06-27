#!/usr/bin/env bash
#
# Run the XMage web gateway (Javalin) locally.
#
#   Mage.Client.Web/scripts/run-gateway.sh [port]   # default 8090
#
# The gateway reuses mage.remote.Session (JBoss Remoting + Java serialization),
# which needs --add-opens on Java 9+. It serves the built frontend from
# Mage.Client.Web/src/main/resources/web and proxies HTTP+WebSocket/JSON to an
# XMage server (default localhost:17171; set in the UI's Local preset).
#
# Build first:  mvn -Pweb-client -pl Mage.Client.Web -am package -DskipTests
# Frontend:     (cd Mage.Client.Web/frontend && npm ci && npm run build)
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
MVN="${MVN:-mvn}"
PORT="${1:-8090}"
cd "$REPO"

# resolve the runtime classpath (cached next to the build)
CP_FILE="Mage.Client.Web/target/gateway-classpath.txt"
if [[ ! -f "$CP_FILE" || "Mage.Client.Web/pom.xml" -nt "$CP_FILE" ]]; then
  echo "Resolving classpath via Maven…" >&2
  "$MVN" -q -Pweb-client -pl Mage.Client.Web dependency:build-classpath \
    -Dmdep.outputFile="$REPO/$CP_FILE" >/dev/null
fi
CP="Mage.Client.Web/target/classes:$(cat "$CP_FILE")"

# JBoss/Java-serialization needs these on Java 9+ (silences InaccessibleObject)
ADD_OPENS=(
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

echo "XMage web gateway on http://localhost:$PORT" >&2
exec java "${ADD_OPENS[@]}" -cp "$CP" mage.client.web.WebClientApp "$PORT"
