# syntax=docker/dockerfile:1

# Stage 1: Build frontend (native, no emulation)
FROM --platform=$BUILDPLATFORM node:20-slim AS frontend
WORKDIR /app
RUN npm i -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY src/ src/
COPY index.html vite.config.ts tsconfig.json ./
COPY tailwind.config.* postcss.config.* ./
COPY public/ public/
RUN pnpm build

# Stage 2: Cross-compile Rust backend for both platforms (native, no emulation)
FROM --platform=$BUILDPLATFORM rust:1-bookworm AS backend
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip gcc-aarch64-linux-gnu gcc-x86-64-linux-gnu \
    && pip3 install --break-system-packages ziglang \
    && cargo install cargo-zigbuild \
    && rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY src-web/ src-web/
RUN mkdir -p src-tauri/src && echo 'fn main() {}' > src-tauri/src/main.rs && echo 'pub fn run() {}' > src-tauri/src/lib.rs
COPY src-tauri/Cargo.toml src-tauri/
COPY src-tauri/build.rs src-tauri/
COPY src-tauri/tauri.conf.json src-tauri/

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo zigbuild --release -p dbx-web \
      --target x86_64-unknown-linux-gnu \
      --target aarch64-unknown-linux-gnu && \
    mkdir -p /out/linux/amd64 /out/linux/arm64 && \
    cp /app/target/x86_64-unknown-linux-gnu/release/dbx-web /out/linux/amd64/ && \
    cp /app/target/aarch64-unknown-linux-gnu/release/dbx-web /out/linux/arm64/

# Stage 3: Final image
FROM debian:bookworm-slim
ARG TARGETPLATFORM
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=backend /out/${TARGETPLATFORM}/dbx-web /usr/local/bin/
COPY --from=frontend /app/dist /app/static
ENV DBX_STATIC_DIR=/app/static
ENV DBX_DATA_DIR=/app/data
EXPOSE 4224
CMD ["dbx-web"]
