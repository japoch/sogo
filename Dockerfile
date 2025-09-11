FROM debian:bookworm-slim AS builder
RUN apt update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tzdata \
    && ln -fs /usr/share/zoneinfo/Europe/Berlin /etc/localtime \
    && dpkg-reconfigure --frontend noninteractive tzdata
RUN apt install -y \
    build-essential \
    git \
    pkg-config \
    libgnustep-base-dev \
    libmariadb-dev-compat \
    libxml2-dev \
    libldap2-dev \
    libpq-dev \
    libcurl4-openssl-dev \
    libmemcached-dev \
    libsodium-dev \
    libzip-dev \
    libytnef0-dev \
    gnutls-dev \
    libssl-dev
WORKDIR /usr/src/app
COPY versions.yaml .
RUN git clone --depth 1 --branch $(grep "sope_git_tag" versions.yaml | cut -d" " -f2) https://github.com/inverse-inc/sope.git \
    && cd sope \
    && ./configure --with-gnustep --disable-debug --enable-strip --enable-mysql \
    && make \
    && make install \
    && cd ..
RUN git clone --depth 1 --branch $(grep "sogo_git_tag" versions.yaml | cut -d" " -f2) https://github.com/inverse-inc/sogo.git \
    && cd sogo \
    && ./configure --disable-debug --enable-strip \
    && make \
    && make install \
    && cd ..


FROM debian:bookworm-slim
RUN apt update \
    && apt install -y --no-install-recommends \
    gnustep-base-runtime \
    libmemcached-tool \
    libzip4 \
    libytnef0 \
    libsodium23 \
    libldap-2.5-0 \
    libcurl4 \
    libmariadb3 \
    nginx \
    sudo \
    procps \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local /usr/local
COPY sogo-conf/sogo.conf /etc/sogo/
COPY artifacts/sogo-backup.sh /usr/local/share/doc/sogo/
COPY artifacts/sogo.cron /etc/cron.d/
COPY artifacts/sogod.sh /usr/local/bin/
COPY nginx-conf/sites-enabled/sogo-nginx.conf /etc/nginx/sites-enabled/
RUN rm /etc/nginx/sites-enabled/default

RUN echo -e "# SOGo libraries\n/usr/local/lib/sogo" > /etc/ld.so.conf.d/sogo.conf \
    && ldconfig --verbose
RUN groupadd -f -r sogo \
    && useradd -d /var/lib/sogo -g sogo -c "SOGo daemon" -s /usr/sbin/nologin -r -g sogo sogo \
    && for dir in lib log run spool; do install -m 750 -o sogo -g sogo -d /var/$dir/sogo; done

EXPOSE 80 443 20000
WORKDIR /var/lib/sogo
USER root
ENTRYPOINT ["/usr/local/bin/sogod.sh"]
