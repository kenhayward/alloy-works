# Throwaway. Node with the Postgres driver, for the realtime spike's instances and its load.
# The scripts are mounted at /app/spike, so `import 'pg'` resolves to /app/node_modules.
FROM node:22-slim
WORKDIR /app
RUN npm init -y >/dev/null && npm install pg@8 >/dev/null
