# git-help search / install bench images (Bun + sqlite-vec)
# Build: docker compose build gate
FROM oven/bun:1.2-debian AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends iproute2 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy workspace package manifests + sources needed to resolve @git-help/core at install
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
COPY scripts/postinstall.js ./scripts/

ENV GIT_HELP_SKIP_POSTINSTALL=1
RUN bun install --frozen-lockfile

COPY . .

# Postinstall smoke + warm MiniLM (needs network during build)
ENV GIT_HELP_SKIP_POSTINSTALL=0
RUN bun scripts/postinstall.js
RUN bun scripts/warm-model.js

# Compiled CLI for the latency gate (Linux; faster process startup)
ENV GIT_HELP_ROOT=/app
RUN mkdir -p bench && bun build --compile ./apps/cli/bin/index.js --outfile ./bench/git-help

# --- search bench (offline) ---
FROM base AS search
ENV GIT_HELP_MOCK_EMBEDDINGS=0
ENV GIT_HELP_ROOT=/app
ENV GIT_HELP_BENCH_COMPILE=1
ENV LD_LIBRARY_PATH=/app/node_modules/onnxruntime-node/bin/napi-v3/linux/x64
CMD ["bun", "run", "bench", "--", "--synthetic", "--json", "--out", "bench/results-docker.json"]

# --- install bench (needs network + tc) ---
FROM oven/bun:1.2-debian AS install
WORKDIR /src
RUN apt-get update \
  && apt-get install -y --no-install-recommends iproute2 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY . /src/repo
WORKDIR /src/repo
CMD ["bun", "run", "bench:install", "--", "--require-tc", "--rate", "5mbit"]
