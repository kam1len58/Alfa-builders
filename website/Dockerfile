FROM node:24.22.1-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY server.mjs ./
COPY server ./server
COPY dist ./dist
COPY config ./config
COPY data/quality-benchmark.json ./data/quality-benchmark.json
RUN mkdir /data && chown -R node:node /app /data
USER node
ENV APP_DATA_DIR=/data
EXPOSE 4173
CMD ["node","server.mjs"]
