# One-shot setup for the object store: layout, bucket, app key and CORS.
# Alpine with a POSIX shell, curl and openssl only. The Garage CLI is copied
# from the pinned server image so the two versions always match.
FROM alpine:3.21

RUN apk add --no-cache curl openssl \
 && adduser -D -u 10001 init

COPY --from=dxflrs/garage:v1.0.1 /garage /usr/local/bin/garage
COPY init.sh /app/init.sh

USER init
ENTRYPOINT ["/bin/sh", "/app/init.sh"]
