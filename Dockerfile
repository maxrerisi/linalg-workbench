# Static site served by nginx. Coolify: use the "Dockerfile" build pack, port 80.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html style.css /usr/share/nginx/html/
COPY js/ /usr/share/nginx/html/js/

# Cache-busting: tag every local script/stylesheet URL with a hash of the asset contents.
# Cloudflare overrides our short max-age with its own browser TTL (hours), so without this,
# returning visitors can keep running stale JS after a deploy. index.html itself is no-cache,
# so a new hash means browsers and the CDN fetch fresh files immediately.
RUN cd /usr/share/nginx/html \
 && v=$(cat style.css js/*.js | md5sum | cut -c1-10) \
 && sed -i -E "s#(src=\"js/[a-z]+\.js|href=\"style\.css)\"#\1?v=$v\"#g" index.html \
 && grep -q "style.css?v=$v" index.html \
 && test "$(grep -c "\.js?v=$v" index.html)" -eq "$(ls js/*.js | wc -l)"

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
