#!/usr/bin/env bash
# Build Cloudopolis and publish it to S3 + CloudFront.
#
#   ./scripts/deploy.sh
#
# Override any of these from the environment:
#   BUCKET=my-bucket DISTRIBUTION_ID=E123 AWS_PROFILE=my-profile ./scripts/deploy.sh
set -euo pipefail

BUCKET="${BUCKET:-simcloud-game-170248754487}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-E3ACNUBHIU7YIY}"
export AWS_PROFILE="${AWS_PROFILE:-mzc-dev}"

cd "$(dirname "$0")/.."

echo "▶ Running engine tests…"
npm test

if [ "${SKIP_E2E:-}" = "1" ]; then
  echo "▶ Skipping smoke suite (SKIP_E2E=1)"
else
  # Builds and previews the app itself, so this also proves the build is good.
  echo "▶ Running smoke suite…"
  npm run test:e2e
fi

echo "▶ Building…"
npm run build

# Vite content-hashes everything under /assets, so those are immutable and can be
# cached forever. index.html is the mutable pointer to them — never cache it.
echo "▶ Uploading hashed assets (immutable)…"
aws s3 sync dist/ "s3://$BUCKET" --delete \
  --exclude "index.html" \
  --cache-control "public, max-age=31536000, immutable"

echo "▶ Uploading index.html (no-cache)…"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache, must-revalidate" \
  --content-type "text/html; charset=utf-8"

echo "▶ Invalidating CloudFront…"
INVALIDATION=$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" --paths "/*" \
  --query 'Invalidation.Id' --output text)

echo "✓ Deployed. Invalidation $INVALIDATION in flight."
aws cloudfront get-distribution --id "$DISTRIBUTION_ID" \
  --query 'Distribution.DomainName' --output text \
  | sed 's|^|  https://|'
