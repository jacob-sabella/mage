# syntax=docker/dockerfile:1.7
# Version-matched XMage server (this fork @ 1.4.60) for the web-client gateway to
# connect to at localhost:17171. Build context = repo root:
#   docker build -f Mage.Server/Dockerfile -t ghcr.io/jacob-sabella/mage-server .
# NOTE: heavy build — pulls in Mage.Sets (the bulk of XMage).

FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
COPY . .
# Build + install the whole reactor, THEN run assembly:single on Mage.Server only
# (the plugin has no phase binding; running it with -am would invoke it on every
# module, incl. mage-root which has no descriptor). Produces target/mage-server.zip.
RUN --mount=type=cache,target=/root/.m2 \
    mvn -q -B -pl Mage.Server -am install -DskipTests && \
    mvn -q -B -pl Mage.Server package assembly:single -DskipTests && \
    mkdir -p /dist && cd /dist && \
    jar xf /src/Mage.Server/target/mage-server.zip   # jar (JDK) avoids needing unzip

FROM eclipse-temurin:17-jre
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig && rm -rf /var/lib/apt/lists/*
COPY --from=build /dist/ /app/
VOLUME ["/app/db"]
EXPOSE 17171
# config/config.xml binds 0.0.0.0:17171. JBoss remoting needs the same --add-opens
# set as the gateway on JDK 17.
ENTRYPOINT ["java", "-Xmx2g", \
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
  "--add-opens", "java.management/sun.management=ALL-UNNAMED", \
  "--add-opens", "java.sql/java.sql=ALL-UNNAMED", \
  "-jar", "lib/mage-server-1.4.60.jar"]
