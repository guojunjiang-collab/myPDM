FROM python:3.12-slim
WORKDIR /app

# 系统依赖
RUN sed -i 's|deb.debian.org/d|mirrors.aliyun.com/d|g' /etc/apt/sources.list.d/debian.sources && \
    sed -i 's|security.debian.org/d|mirrors.aliyun.com/d|g' /etc/apt/sources.list.d/debian.sources && \
    sed -i 's/Components: main/Components: main non-free/g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update && apt-get install -y libpq-dev gcc unrar xvfb libfuse2 \
        libfontconfig1 libgl1 libglib2.0-0 libxkbcommon0 libegl1 libreoffice && \
    rm -rf /var/lib/apt/lists/*

# Mayo CLI — OCC 原生 STEP→GLB 转换器（手动下载的 AppImage）
COPY MayoConv-0.9.0-x86_64.AppImage /usr/local/bin/MayoConv
RUN chmod +x /usr/local/bin/MayoConv && mkdir -p /app/mayo_settings

# Python 依赖
COPY requirements.txt .
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ && \
    pip config set global.extra-index-url https://pypi.org/simple/ && \
    pip install --no-cache-dir -r requirements.txt

COPY ./app ./app

# 非 root 用户
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
