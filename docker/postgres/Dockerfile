# Local Postgres 17 on Alpine (about 63 MB, against about 425 MB for the
# official image). Pinned to the major version CI uses.
FROM alpine:3.21

RUN apk add --no-cache postgresql17 postgresql17-client

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
# Runs once, on the first start of an empty data volume, in name order.
COPY initdb/ /docker-entrypoint-initdb.d/

ENV PGDATA=/var/lib/postgresql/data
RUN mkdir -p "$PGDATA" /run/postgresql \
 && chown -R postgres:postgres /var/lib/postgresql /run/postgresql \
 && chmod 700 "$PGDATA" && chmod 755 /usr/local/bin/entrypoint.sh

USER postgres
EXPOSE 5432
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["postgres"]
