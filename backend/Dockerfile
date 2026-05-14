FROM python:3.12-slim
WORKDIR /app
RUN sed -i 's|deb.debian.org/d|mirrors.aliyun.com/d|g' /etc/apt/sources.list.d/debian.sources && \
    sed -i 's|security.debian.org/d|mirrors.aliyun.com/d|g' /etc/apt/sources.list.d/debian.sources && \
    sed -i 's/Components: main/Components: main non-free/g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update && apt-get install -y libpq-dev gcc unrar gmsh libgmsh4.13 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ && \
    pip config set global.extra-index-url https://pypi.org/simple/ && \
    pip install --no-cache-dir -r requirements.txt
COPY ./app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
