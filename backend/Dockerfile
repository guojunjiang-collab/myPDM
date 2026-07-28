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

# 许可模块公钥（构建时注入，绝不入版本库）
ARG LICENSE_PUBKEY

COPY ./app ./app

# 编译许可核心三文件为 .so，并删除对应 .py 源码
RUN test -n "$LICENSE_PUBKEY" || (echo "LICENSE_PUBKEY build-arg 未提供" && exit 1) && \
    pip install --no-cache-dir cython==3.0.11 && \
    sed -i "s|@@LICENSE_PUBKEY@@|${LICENSE_PUBKEY}|" app/licensing/verifier.py && \
    grep -q "@@LICENSE_PUBKEY@@" app/licensing/verifier.py && (echo "公钥注入失败" && exit 1) || true && \
    cythonize -i -3 app/licensing/verifier.py app/licensing/fingerprint.py app/licensing/state.py && \
    rm -f app/licensing/verifier.py app/licensing/fingerprint.py app/licensing/state.py \
          app/licensing/verifier.c app/licensing/fingerprint.c app/licensing/state.c && \
    pip uninstall -y cython && \
    python -c "from app.licensing import state; print('licensing 编译校验通过')"

# 非 root 用户
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
