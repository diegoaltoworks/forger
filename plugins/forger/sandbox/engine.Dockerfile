# The engine as a container: the base image plus the Docker client, so the engine
# starts each worker container through the Docker API socket it is given. The
# host's home folder is never mounted.
ARG BASE=forger-sandbox:base
FROM ${BASE}
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends docker-cli \
 && rm -rf /var/lib/apt/lists/*
# The Docker socket's group is the host's, so the engine runs as root inside its own container only.
WORKDIR /engine
