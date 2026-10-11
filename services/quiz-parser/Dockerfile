FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 1000 worker
COPY --chown=worker:worker quiz_parser ./quiz_parser
USER worker
CMD ["sh", "-c", "uvicorn quiz_parser.api:create_app --factory --host 0.0.0.0 --port ${PORT} --workers 1"]
