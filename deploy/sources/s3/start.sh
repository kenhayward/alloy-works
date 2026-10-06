#!/bin/sh
# A tenant's own S3 bucket, for development and CI only (the D6 plan, task 2): SeaweedFS, HTTPS by
# the development S3 CA beside this file, the invented key pairs in identities.json - `source-s3-reader`
# reads `alloy-readings` alone, `source-s3-seeder` everything - and the objects under ./objects, one
# folder a bucket, uploaded through the filer once it answers. Ready once /tmp/seeded exists.
set -e
weed server -dir=/data -s3 -s3.port=8333 \
  -s3.config=/srv/s3/identities.json \
  -s3.cert.file=/srv/s3/server.pem -s3.key.file=/srv/s3/server-key.pem &
server=$!
until curl -fs -o /dev/null http://127.0.0.1:8888/ && curl -fsk -o /dev/null https://127.0.0.1:8333/healthz; do
  sleep 1
done
cd /srv/s3/objects
find . -type f | while read -r file; do
  folder=$(dirname "$file" | sed 's#^\./##')
  curl -fs -o /dev/null -F "file=@$file" "http://127.0.0.1:8888/buckets/$folder/"
done
touch /tmp/seeded
wait "$server"
