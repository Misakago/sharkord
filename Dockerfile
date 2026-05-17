FROM oven/bun:1.3.14

ARG TARGETARCH
ENV RUNNING_IN_DOCKER=true

USER root

COPY apps/server/build/out/mikotord-linux-x64 /tmp/mikotord-linux-x64
COPY apps/server/build/out/mikotord-linux-arm64 /tmp/mikotord-linux-arm64

RUN set -eux; \
    case "$TARGETARCH" in \
      amd64)  cp /tmp/mikotord-linux-x64 /mikotord ;; \
      arm64)  cp /tmp/mikotord-linux-arm64 /mikotord ;; \
      *) echo "Unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    chmod +x /mikotord; \
    chown bun:bun /mikotord; \
    rm -rf /tmp/mikotord-linux-*

RUN mkdir -p /home/bun/.config/mikotord && \
    chown -R bun:bun /home/bun/.config

COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /home/bun

ENTRYPOINT ["/entrypoint.sh"]