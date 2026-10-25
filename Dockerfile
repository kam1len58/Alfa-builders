FROM python:3.12-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY data/ ./data/
COPY .env.example .env

EXPOSE 8000

# Команда запуска — заменить на реальный модуль, когда бэкендер сделает api.py
CMD ["python", "-m", "src.evaluate"]