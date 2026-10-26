FROM node:24.22.1-bookworm-slim AS web
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM python:3.12-slim-bookworm
COPY --from=web /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY ml/requirements.txt ./ml/requirements.txt
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir -r ml/requirements.txt
COPY --from=web /app/node_modules ./node_modules
COPY server.mjs ./
COPY server ./server
COPY dist ./dist
COPY config ./config
COPY data/quality-benchmark.json ./data/quality-benchmark.json
COPY ml/src ./ml/src
COPY ml/data/business_matrix.json ./ml/data/business_matrix.json
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --create-home app && mkdir /data && chown -R app:app /app /data
USER app
ENV APP_DATA_DIR=/data ML_ENABLED=1 ML_PYTHON_EXE=/usr/local/bin/python HF_HUB_DISABLE_TELEMETRY=1 PYTHONUTF8=1
EXPOSE 4173
CMD ["node","server.mjs"]
