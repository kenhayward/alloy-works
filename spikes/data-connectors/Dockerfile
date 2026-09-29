# Throwaway spike image: Node 22 with the two DB drivers. Not the product's service or worker.
FROM node@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d
WORKDIR /app
COPY package.json ./
# No lock file for a throwaway; versions are pinned in package.json. Offline registry uses the
# machine's default. Install only production deps.
RUN npm install --omit=dev --no-audit --no-fund
COPY lib ./lib
COPY *.mjs ./
ENV NODE_ENV=production
CMD ["node", "--version"]
