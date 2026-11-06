# Forger's base image for a worker: git, the GitHub CLI, the runtimes and package
# managers a typical stack needs, one harness CLI, and the pinned forger plugin.
# Build args pick the harness package and the forger version.
FROM oven/bun:1-debian

ARG HARNESS_PACKAGE=@anthropic-ai/claude-code
ARG FORGER_VERSION=main

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gh nodejs npm python3 python3-pip pipx chromium \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g "${HARNESS_PACKAGE}" \
 && pipx install uv || true

# The plugin at the pinned version, where the harness loads it from.
RUN git clone --quiet --depth 1 --branch "${FORGER_VERSION}" https://github.com/diegoaltoworks/forger /opt/forger

# Caches are named volumes shared between runs of one repository; any user may write them.
RUN mkdir -p /cache/bun /cache/uv /cache/npm && chmod -R 777 /cache

# A harness refuses to run unattended as root, so the worker is an ordinary user.
RUN useradd --create-home --uid 1001 forger
USER forger
ENV FORGER_PLUGIN_ROOT=/opt/forger/plugins/forger
WORKDIR /work
