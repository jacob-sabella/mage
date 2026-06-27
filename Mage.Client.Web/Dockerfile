# syntax=docker/dockerfile:1.7
# Web-client gateway image. Build context = repo root:
#   docker build -f Mage.Client.Web/Dockerfile -t ghcr.io/jacob-sabella/mage-web .

##########################################################################
# Stage 1 — build the React/Vite frontend. Vite's outDir is
# ../src/main/resources/web, so the SPA lands in the module resources.
##########################################################################
FROM node:20-bookworm AS frontend
WORKDIR /src/Mage.Client.Web/frontend
COPY Mage.Client.Web/frontend/package.json Mage.Client.Web/frontend/package-lock.json ./
RUN npm ci
COPY Mage.Client.Web/frontend/ ./
RUN npm run build

##########################################################################
# Stage 2 — build the Java gateway (web-client profile) and collect a
# self-contained runtime classpath (module jar + all runtime deps).
##########################################################################
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
COPY . .
# overlay the freshly built SPA over whatever was committed in resources/web
COPY --from=frontend /src/Mage.Client.Web/src/main/resources/web/ \
                     /src/Mage.Client.Web/src/main/resources/web/
RUN --mount=type=cache,target=/root/.m2 \
    mvn -q -B -Pweb-client -pl Mage.Client.Web -am install -DskipTests && \
    mvn -q -B -Pweb-client -pl Mage.Client.Web \
        dependency:copy-dependencies \
        -DoutputDirectory=Mage.Client.Web/target/lib \
        -DincludeScope=runtime

##########################################################################
# Stage 3 — minimal JRE 17 runtime.
##########################################################################
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /src/Mage.Client.Web/target/mage-client-web.jar /app/mage-client-web.jar
COPY --from=build /src/Mage.Client.Web/target/lib/                /app/lib/
COPY --from=build /src/Mage.Client/release/sample-decks/ /app/Mage.Client/release/sample-decks/

ENV MAGE_WEB_PORT=8090 \
    MAGE_IMAGE_DIR=/data/images \
    MAGE_DECK_DIR=/data/decks \
    GITHUB_REPO=jacob-sabella/mage

# card DB (db/cards.h2.mv.db read from CWD), card art, and decks are provided as
# volumes at runtime — never baked into the image (the art set is ~15GB).
VOLUME ["/app/db", "/data/images", "/data/decks"]
EXPOSE 8090

# JBoss Remoting + Java serialization require these --add-opens on Java 9+.
ENTRYPOINT ["java", \
  "--add-opens", "java.base/java.lang=ALL-UNNAMED", \
  "--add-opens", "java.base/java.lang.reflect=ALL-UNNAMED", \
  "--add-opens", "java.base/java.io=ALL-UNNAMED", \
  "--add-opens", "java.base/java.net=ALL-UNNAMED", \
  "--add-opens", "java.base/java.nio=ALL-UNNAMED", \
  "--add-opens", "java.base/java.util=ALL-UNNAMED", \
  "--add-opens", "java.base/java.util.concurrent=ALL-UNNAMED", \
  "--add-opens", "java.base/java.util.concurrent.atomic=ALL-UNNAMED", \
  "--add-opens", "java.base/java.text=ALL-UNNAMED", \
  "--add-opens", "java.base/java.math=ALL-UNNAMED", \
  "--add-opens", "java.base/sun.nio.ch=ALL-UNNAMED", \
  "--add-opens", "java.desktop/java.awt=ALL-UNNAMED", \
  "--add-opens", "java.desktop/java.awt.font=ALL-UNNAMED", \
  "--add-opens", "java.desktop/sun.awt=ALL-UNNAMED", \
  "--add-opens", "java.management/sun.management=ALL-UNNAMED", \
  "--add-opens", "java.sql/java.sql=ALL-UNNAMED", \
  "-cp", "/app/mage-client-web.jar:/app/lib/*", \
  "mage.client.web.WebClientApp"]
