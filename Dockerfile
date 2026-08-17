# git-grasp search / install bench images (Bun + sqlite-vec)
# Build: docker compose build gate
FROM oven/bun:1.3.14-debian AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends iproute2 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy workspace package manifests + sources needed to resolve @git-grasp/common at install
COPY package.json bun.lock ./
COPY common ./common
COPY apps ./apps

ENV GIT_GRASP_SKIP_POSTINSTALL=1
RUN bun install --frozen-lockfile

COPY . .

# Postinstall smoke + warm MiniLM (needs network during build)
ENV GIT_GRASP_SKIP_POSTINSTALL=0
RUN bun common/scripts/postinstall.ts
RUN bun common/scripts/warm-model.ts

# Compiled CLI for the latency gate (Linux; faster process startup)
ENV GIT_GRASP_ROOT=/app
RUN mkdir -p local/bench && bun build --compile ./apps/cli/bin/index.ts --outfile ./local/bench/git-grasp

# --- search bench (offline) ---
FROM base AS search
ENV GIT_GRASP_MOCK_EMBEDDINGS=0
ENV GIT_GRASP_ROOT=/app
ENV GIT_GRASP_BENCH_COMPILE=1
ENV LD_LIBRARY_PATH=/app/node_modules/onnxruntime-node/bin/napi-v3/linux/x64
CMD ["bun", "run", "bench", "--", "--synthetic", "--json", "--out", "local/bench/results-docker.json"]

# --- install bench (needs network + tc) ---
FROM oven/bun:1.3.14-debian AS install
WORKDIR /src
RUN apt-get update \
  && apt-get install -y --no-install-recommends iproute2 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY . /src/repo
WORKDIR /src/repo
CMD ["bun", "run", "bench:install", "--", "--require-tc", "--rate", "5mbit"]
