#!/bin/sh
# Idempotent setup for the local Garage node. Safe to run on every `up`:
# each step checks first and does nothing when it is already done.
#
# Needs: GARAGE_RPC_SECRET (read by the garage CLI), S3_ACCESS_KEY_ID,
# S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION, S3_ENDPOINT (http://host:port),
# CORS_ORIGINS (comma-separated origins allowed to upload directly).
set -eu

: "${GARAGE_RPC_SECRET:?}" "${S3_ACCESS_KEY_ID:?}" "${S3_SECRET_ACCESS_KEY:?}"
BUCKET="${S3_BUCKET:-vml-images}"
REGION="${S3_REGION:-garage}"
ENDPOINT="${S3_ENDPOINT:-http://garage:3900}"
ORIGINS="${CORS_ORIGINS:-http://localhost:3000}"
HOST_PORT="${ENDPOINT#*://}"
HOST_PORT="${HOST_PORT%%/*}"

log() { echo "[garage-init] $*"; }
garage() { command garage -c /etc/garage.toml "$@"; }

# ---- wait for the node ------------------------------------------------------
i=0
until garage status >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then log "Garage node did not answer in 60 seconds"; exit 1; fi
  sleep 1
done

# ---- layout: one node, one zone, applied once ------------------------------
if garage status | grep -q "NO ROLE ASSIGNED"; then
  node_id="$(garage node id -q | cut -d@ -f1)"
  garage layout assign -z dc1 -c 1G "$node_id"
  current="$(garage layout show | sed -n 's/.*[Vv]ersion[^0-9]*\([0-9][0-9]*\).*/\1/p' | head -n1)"
  garage layout apply --version "$(( ${current:-0} + 1 ))"
  log "layout applied"
else
  log "layout already assigned"
fi

# ---- app key: imported from our config so the app and the store agree -------
if garage key info "$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
  log "app key already present"
else
  garage key import --yes "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" -n vml-app >/dev/null
  log "app key imported"
fi

# ---- bucket, with the app key as owner -------------------------------------
if ! garage bucket info "$BUCKET" >/dev/null 2>&1; then
  garage bucket create "$BUCKET" >/dev/null
  log "bucket $BUCKET created"
fi
garage bucket allow --read --write --owner "$BUCKET" --key "$S3_ACCESS_KEY_ID" >/dev/null

# ---- CORS: Garage has no CLI for it, so sign a PutBucketCors request ---------
rules=""
IFS_OLD="$IFS"; IFS=','
for origin in $ORIGINS; do
  origin="$(echo "$origin" | tr -d ' ')"
  [ -n "$origin" ] || continue
  rules="${rules}<CORSRule><AllowedOrigin>${origin}</AllowedOrigin><AllowedMethod>PUT</AllowedMethod><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3000</MaxAgeSeconds></CORSRule>"
done
IFS="$IFS_OLD"

body="$(mktemp)"
printf '<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration>%s</CORSConfiguration>' "$rules" > "$body"

amz_date="$(date -u +%Y%m%dT%H%M%SZ)"
date_stamp="${amz_date%T*}"
payload_hash="$(sha256sum "$body" | cut -d' ' -f1)"
canonical_request="$(printf 'PUT\n/%s\ncors=\nhost:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n\nhost;x-amz-content-sha256;x-amz-date\n%s' \
  "$BUCKET" "$HOST_PORT" "$payload_hash" "$amz_date" "$payload_hash")"
scope="$date_stamp/$REGION/s3/aws4_request"
string_to_sign="$(printf 'AWS4-HMAC-SHA256\n%s\n%s\n%s' "$amz_date" "$scope" \
  "$(printf '%s' "$canonical_request" | sha256sum | cut -d' ' -f1)")"

# HMAC chain. The first key is text; each later key is the previous digest.
hmac_text() { printf '%s' "$2" | openssl dgst -sha256 -mac HMAC -macopt "key:$1" -r | cut -d' ' -f1; }
hmac_hex()  { printf '%s' "$2" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$1" -r | cut -d' ' -f1; }
k_date="$(hmac_text "AWS4$S3_SECRET_ACCESS_KEY" "$date_stamp")"
k_region="$(hmac_hex "$k_date" "$REGION")"
k_service="$(hmac_hex "$k_region" s3)"
k_signing="$(hmac_hex "$k_service" aws4_request)"
signature="$(hmac_hex "$k_signing" "$string_to_sign")"

status="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT \
  --data-binary "@$body" \
  -H "content-type: application/xml" \
  -H "x-amz-content-sha256: $payload_hash" \
  -H "x-amz-date: $amz_date" \
  -H "authorization: AWS4-HMAC-SHA256 Credential=$S3_ACCESS_KEY_ID/$scope, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=$signature" \
  "$ENDPOINT/$BUCKET?cors")"
rm -f "$body"

if [ "$status" != "200" ]; then
  log "CORS update failed: HTTP $status"
  exit 1
fi
log "CORS set for $ORIGINS"
log "ready"
