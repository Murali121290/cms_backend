FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CMS_RUNTIME_ROOT=/opt/cms_runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    make \
    curl \
    git \
    libpq-dev \
    libxml2 \
    libxml2-dev \
    libxslt-dev \
    zlib1g-dev \
    libreoffice-writer \
    libreoffice-java-common \
    default-jre \
    perl \
    cpanminus \
    && rm -rf /var/lib/apt/lists/*

RUN cpanm --notest \
    Archive::Zip \
    File::Copy::Recursive \
    File::HomeDir \
    HTTP::Tiny \
    List::MoreUtils \
    String::Substitution \
    Try::Tiny \
    XML::LibXML

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY alembic.ini ./
COPY app ./app
COPY alembic ./alembic
COPY migrations ./migrations

RUN mkdir -p \
    /opt/cms_runtime/data/uploads \
    /app/outputs \
    /app/temp_reports \
    && touch /opt/cms_runtime/ref_cache.json \
    && ln -sf /opt/cms_runtime/ref_cache.json /app/ref_cache.json

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:8000/ > /dev/null || exit 1

CMD ["gunicorn", \
    "--workers", "4", \
    "--worker-class", "uvicorn.workers.UvicornWorker", \
    "--bind", "0.0.0.0:8000", \
    "--timeout", "300", \
    "--access-logfile", "-", \
    "--error-logfile", "-", \
    "app.main:app"]
