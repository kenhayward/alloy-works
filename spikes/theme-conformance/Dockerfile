# Throwaway. The three renderers the theme conformance harness measures: Chromium for the editor's
# CSS, Typst for the PDF, and LibreOffice Writer as a stand-in for Word - which is a proxy, and is
# said to be one. Word itself is checked by opening the output in Word (PUB-029).
FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive HOME=/tmp
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv nodejs npm chromium libreoffice-writer-nogui \
      fonts-liberation2 ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/py && /opt/py/bin/pip install --no-cache-dir pdfplumber
ENV PATH=/opt/py/bin:$PATH

ARG TYPST_VERSION=0.15.1
RUN curl -fsSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz" \
      | tar -xJ -C /tmp \
    && mv /tmp/typst-x86_64-unknown-linux-musl/typst /usr/local/bin/typst

WORKDIR /opt/node
RUN npm init -y >/dev/null && PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund puppeteer-core
ENV NODE_PATH=/opt/node/node_modules CHROMIUM=/usr/bin/chromium

WORKDIR /spike
