# syntax=docker/dockerfile:1
#
# community-node container. Build from the repository root:
#   docker build -f deploy/Dockerfile -t vamo-virar/community-node .
#
# Docker is optional: the same binary runs anywhere (see docs/deploy.md).

FROM rust:1.97-slim-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY apps/node ./apps/node
# Behind a TLS-intercepting proxy, pass its CA bundle as a build secret:
#   docker build --secret id=ca_bundle,src=/path/to/ca.pem ...
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    --mount=type=secret,id=ca_bundle,required=false \
    if [ -f /run/secrets/ca_bundle ]; then export CARGO_HTTP_CAINFO=/run/secrets/ca_bundle; fi \
    && cargo build -p community-node --release --locked \
    && cp target/release/community-node /community-node \
    && mkdir /data

# Minimal runtime: glibc + libgcc, no shell, no package manager, non-root.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /community-node /usr/local/bin/community-node
COPY --from=build --chown=65532:65532 /data /data
ENV VV_LISTEN=0.0.0.0:8787 \
    VV_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
USER 65532:65532
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
    CMD ["/usr/local/bin/community-node", "health", "--url", "http://127.0.0.1:8787"]
ENTRYPOINT ["/usr/local/bin/community-node"]
