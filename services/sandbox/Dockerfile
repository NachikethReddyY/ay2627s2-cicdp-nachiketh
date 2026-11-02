FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends bash python3 python3-pip python3-venv git ca-certificates less procps \
 && rm -rf /var/lib/apt/lists/*

# pip refuses system-wide installs on Debian 12; a venv on PATH lets `pip install` just work.
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV && chown -R 1001:1001 $VIRTUAL_ENV
ENV PATH=$VIRTUAL_ENV/bin:$PATH
# Shells open with `bash -l`, and /etc/profile resets PATH, so add the venv back there.
RUN echo 'export PATH=/opt/venv/bin:$PATH' > /etc/profile.d/venv.sh

RUN useradd -m -u 1001 -s /bin/bash learner
USER learner
WORKDIR /home/learner
ENV TERM=xterm-256color
CMD ["sleep", "infinity"]
