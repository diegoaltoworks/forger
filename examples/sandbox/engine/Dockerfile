# An engine image for sandbox_engine_image: the worker contract plus the docker CLI.
FROM debian:bookworm-slim

ARG HARNESS_PACKAGE=@anthropic-ai/claude-code
ARG NODE_MAJOR=22

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg unzip chromium docker.io \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
 && apt-get install -y --no-install-recommends gh nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash \
 && npm install -g "${HARNESS_PACKAGE}"

ENV CHROME_BIN=/usr/bin/chromium

RUN useradd --create-home --shell /bin/bash worker \
 && mkdir -p /workspace && chown worker /workspace
USER worker
WORKDIR /workspace
