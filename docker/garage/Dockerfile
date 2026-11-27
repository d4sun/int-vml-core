# Garage: a small S3-compatible object store (about 32 MB) for pictures.
# Pinned. Its image has no shell, so setup runs from ../garage/init instead.
FROM dxflrs/garage:v1.0.1

COPY garage.toml /etc/garage.toml

EXPOSE 3900 3903

# Secrets come from the environment (GARAGE_RPC_SECRET, GARAGE_ADMIN_TOKEN),
# never from this file.
CMD ["/garage", "-c", "/etc/garage.toml", "server"]
