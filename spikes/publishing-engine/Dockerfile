# Throwaway. The four candidate engines from docs/specification/Publishing_Engine_Spike.md in one
# Linux image, so every case renders under identical conditions and CI's OS. veraPDF runs from its
# own official image (verapdf/cli) rather than being installed here.
FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv \
      nodejs npm \
      chromium \
      poppler-utils qpdf \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 \
      fonts-liberation2 fonts-noto-core fonts-dejavu-core \
      ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

# WeasyPrint, plus the PDF inspection libraries the checks use.
RUN python3 -m venv /opt/py \
    && /opt/py/bin/pip install --no-cache-dir weasyprint pikepdf pdfplumber latex2mathml defusedxml
ENV PATH=/opt/py/bin:$PATH

# Typst, from its official release rather than a distribution package that may lag. The image
# builds for amd64 and arm64 alike, because case 9's second machine is a different architecture.
ARG TYPST_VERSION=0.15.1
ARG TARGETARCH
RUN case "$TARGETARCH" in arm64) A=aarch64 ;; *) A=x86_64 ;; esac \
    && curl -fsSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${A}-unknown-linux-musl.tar.xz" \
      | tar -xJ -C /tmp \
    && mv "/tmp/typst-${A}-unknown-linux-musl/typst" /usr/local/bin/typst

# PagedJS as its polyfill, driven by the same system Chromium the headless Chrome case uses, so the
# two differ only in whether PagedJS paginates.
WORKDIR /opt/node
RUN npm init -y >/dev/null \
    && PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund puppeteer-core pagedjs mathjax-full
ENV NODE_PATH=/opt/node/node_modules \
    CHROMIUM=/usr/bin/chromium

WORKDIR /spike
