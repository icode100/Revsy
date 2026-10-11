FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY services/quiz-gemini/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 1000 worker
COPY --chown=worker:worker services/quiz-parser/quiz_parser ./quiz_parser
COPY --chown=worker:worker services/quiz-gemini/quiz_gemini ./quiz_gemini
USER worker
CMD ["sh", "-c", "uvicorn quiz_gemini.app:create_application --factory --host 0.0.0.0 --port ${PORT} --workers 1"]
