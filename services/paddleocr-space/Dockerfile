# After a successful GPU smoke test, pin this official image to its tested digest.
FROM ccr-2vdh3abv-pub.cnc.bj.baidubce.com/paddlepaddle/paddleocr-vl:latest-nvidia-gpu

USER root
RUN paddlex --install serving
COPY requirements.txt /tmp/revsy-ocr-requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/revsy-ocr-requirements.txt

# HF Docker Spaces run as UID 1000. Reuse that UID if present in the official image.
RUN if ! getent passwd 1000 >/dev/null; then useradd --create-home --uid 1000 revsy; fi \
    && mkdir -p /home/user/app /home/user/.cache /home/user/.paddlex \
    && chown 1000:1000 /home/user /home/user/app /home/user/.cache /home/user/.paddlex
ENV HOME=/home/user \
    XDG_CACHE_HOME=/home/user/.cache \
    HF_HOME=/home/user/.cache/huggingface \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /home/user/app
COPY --chown=1000:1000 app.py ./app.py
USER 1000:1000
RUN python -c "import os, shutil, fastapi, httpx, uvicorn; p = shutil.which('paddlex'); assert p and os.access(p, os.X_OK), 'PaddleX CLI must be executable by UID 1000'"
EXPOSE 7860
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1", "--no-access-log"]
