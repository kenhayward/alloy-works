#!/bin/sh
# The delivery store's pg_hba (ct-studio-sink.md, "Deployment"), written on every start so the
# `delivered` network's subnet comes from the stack (DELIVERED_SUBNET) and not from a file baked in
# the volume. From anywhere, only members of `delivered_readers` (each tenant's read role joins it
# when the space is provisioned) reach the database `delivered`, over TLS, with a password. The owner
# reaches it only from the `delivered` network, where the service and the worker are and the
# connector is not. Everything else is refused, so the connector can never sign in as the owner.
# The socket line is for the image's own first-start setup and for `docker exec`.
set -e
: "${DELIVERED_SUBNET:?DELIVERED_SUBNET is the delivered network's subnet}"
cat > /tmp/pg_hba.conf <<EOF
local   all        postgres                              peer
hostssl all        postgres            ${DELIVERED_SUBNET} scram-sha-256
hostssl delivered  +delivered_readers  all               scram-sha-256
host    all        all                 all               reject
local   all        all                                   reject
EOF
chmod 0644 /tmp/pg_hba.conf
exec docker-entrypoint.sh postgres \
  -c ssl=on \
  -c ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem \
  -c ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key \
  -c hba_file=/tmp/pg_hba.conf
