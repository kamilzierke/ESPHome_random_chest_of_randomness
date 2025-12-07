FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        pipx \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

USER vscode
RUN pipx install esphome && pipx ensurepath
USER root

ENV PATH="/home/vscode/.local/bin:${PATH}"
