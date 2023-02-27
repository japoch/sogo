FROM debian:stretch-slim as builder
RUN apt update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tzdata \
    && ln -fs /usr/share/zoneinfo/Europe/Berlin /etc/localtime \
    && dpkg-reconfigure --frontend noninteractive tzdata
RUN apt install -y \
    build-essential \
    git \
    libgnustep-base-dev \
    libmariadbclient-dev-compat \
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
RUN git clone https://github.com/inverse-inc/sope.git \
    && cd sope && ./configure --with-gnustep --disable-debug --enable-strip && make && make install && cd ..
RUN git clone https://github.com/inverse-inc/sogo.git \
    && cd sogo && ./configure --disable-debug --enable-strip && make && make install && cd ..


FROM debian:stretch-slim
RUN apt update \
    && apt install -y gnustep-base-runtime libmemcached-tools libzip4 libytnef0 libsodium18 libldap-2.4.2 libcurl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local /usr/local
COPY config-sogo/sogo.conf /etc/sogo/
COPY sogo-backup.sh /usr/local/share/doc/sogo/
COPY sogo.cron /etc/cron.d/
COPY sogod.sh /usr/local/bin/
RUN echo -e "# SOGo libraries\n/usr/local/lib/sogo" > /etc/ld.so.conf.d/sogo.conf \
    && ldconfig --verbose
RUN groupadd -f -r sogo \
    && useradd -d /var/lib/sogo -g sogo -c "SOGo daemon" -s /usr/sbin/nologin -r -g sogo sogo \
    && for dir in lib log run spool; do install -m 750 -o sogo -g sogo -d /var/$dir/sogo; done
EXPOSE 80
WORKDIR /var/lib/sogo
USER sogo
ENTRYPOINT ["/usr/local/bin/sogod.sh"]
