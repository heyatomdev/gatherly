FROM node:24.15.0-slim AS builder

ENV NODE_ENV=build

# Create app directory
WORKDIR /usr/src/app

# Install pnpm (no native modules to compile, so no build toolchain)
RUN npm install -g pnpm@10.14.0

# Install app dependencies (including dev dependencies) for the build
COPY package.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Bundle app source
COPY . .

# Generate Prisma client and build
RUN pnpm run prisma:generate
RUN pnpm build

# Remove devDependencies to keep only production deps (pruned node_modules)
RUN pnpm prune --prod

# Drop what prune keeps but the runtime never loads:
# - the prisma CLI (+ studio, react, typescript, pglite): kept as a resolved peer of
#   @prisma/client; migrations aren't run from this image
# - the query compilers of every database but postgres
RUN cd node_modules/.pnpm \
 && rm -rf prisma@* @prisma+studio-core@* @prisma+engines@* @prisma+dev@* @electric-sql+pglite* \
           typescript@* effect@* react@* react-dom@* \
 && find @prisma+client@*/node_modules/@prisma/client/runtime \
      \( -name '*cockroachdb*' -o -name '*mysql*' -o -name '*sqlite*' -o -name '*sqlserver*' \) -delete

# Start a fresh runtime image
FROM node:24.15.0-slim AS prod

# Set the NODE_ENV to production
ENV NODE_ENV=production

# Create app directory
WORKDIR /usr/src/app

# Create a non-root user and group with specific UID/GID to match host user
RUN groupadd -g 1001 app && useradd -u 1001 -g app -m app

# Pull Debian security fixes not yet in the base image and remove npm
# (not needed at runtime; its bundled deps carry CVEs)
RUN apt-get update && \
    apt-get upgrade -y --no-install-recommends && \
    rm -rf /var/lib/apt/lists/* && \
    npm uninstall -g npm corepack

# Copy built artifacts and dependencies from builder with ownership set during copy
COPY --chown=app:app package.json pnpm-lock.yaml ./
COPY --from=builder --chown=app:app /usr/src/app/prisma ./prisma
COPY --from=builder --chown=app:app /usr/src/app/dist ./dist
COPY --from=builder --chown=app:app /usr/src/app/node_modules ./node_modules

# Switch to non-root user
USER app

# Start the server using the production build
CMD [ "node", "dist/main.js" ]
