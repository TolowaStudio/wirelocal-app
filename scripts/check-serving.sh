#!/usr/bin/env bash
# Serves dist/ with the repo's nginx.conf and checks routes. Needs docker and a built dist/.
set -euo pipefail
cd "$(dirname "$0")/.."
grep -q 'id="cities"' dist/index.html && grep -q 'id="features"' dist/index.html
name=wl-check-$$
docker run -d --rm --name "$name" -p 18080:8080 \
  -v "$PWD/dist:/usr/share/nginx/html:ro" \
  -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine >/dev/null
trap 'docker stop "$name" >/dev/null' EXIT
for i in $(seq 20); do curl -s -o /dev/null localhost:18080/ && break; sleep 0.5; done
fail=0
for p in /privacy /privacy/ /terms /terms/; do
  h=$(curl -si "localhost:18080$p")
  echo "$h" | head -1 | grep -q 200 && ! echo "$h" | grep -qi '^location:' || { echo "FAIL $p"; fail=1; }
done
h=$(curl -si localhost:18080/nope)
echo "$h" | head -1 | grep -q 404 && echo "$h" | grep -qi 'not found' || { echo "FAIL /nope"; fail=1; }
exit $fail
