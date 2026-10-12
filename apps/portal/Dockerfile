# syntax=docker/dockerfile:1
#
# Access-request portal. Build from the repository root:
#   docker build -f apps/portal/Dockerfile -t vamo-virar/portal .
# (The root .dockerignore picks what goes in.)

FROM node:22-alpine AS build
WORKDIR /src/apps/portal
COPY tsconfig.base.json /src/
COPY apps/portal/package.json ./
# Behind a TLS-intercepting proxy, pass its CA bundle as a build secret:
#   docker build --secret id=ca_bundle,src=/path/to/ca.pem ...
RUN --mount=type=secret,id=ca_bundle,required=false \
    if [ -f /run/secrets/ca_bundle ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle; fi \
    && npm install --no-audit --no-fund
COPY apps/portal/tsconfig.json apps/portal/tsconfig.build.json ./
COPY apps/portal/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    PORTAL_DATA_DIR=/data \
    PORTAL_PORT=3000
WORKDIR /app
COPY --from=build /src/apps/portal/package.json ./
COPY --from=build /src/apps/portal/node_modules ./node_modules
COPY --from=build /src/apps/portal/dist ./dist
RUN mkdir /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
    CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/main.js"]
