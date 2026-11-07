FROM debian:bookworm-slim

ARG HARNESS_PACKAGE=@anthropic-ai/claude-code
ARG NODE_MAJOR=22

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg unzip chromium \
 && curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash \
 && npm install -g "${HARNESS_PACKAGE}"

RUN useradd --create-home --shell /bin/bash worker \
 && mkdir -p /workspace && chown worker /workspace
USER worker
WORKDIR /workspace
