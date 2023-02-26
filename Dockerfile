FROM balenalib/raspberrypi3-ubuntu-python:3.6.9 as builder
RUN apt update
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tzdata \
    && ln -fs /usr/share/zoneinfo/Europe/Berlin /etc/localtime \
    && dpkg-reconfigure --frontend noninteractive tzdata
RUN apt install -y \
    libgnustep-base-dev \
    libmariadbclient-dev-compat \
    libxml2-dev \
    libldap2-dev \
    libpq-dev \
    libcurl4-openssl-dev \
    libmemcached-dev \
    libsodium-dev \
    libzip-dev \
    libytnef0-dev
WORKDIR /usr/src/app
RUN apt install -y --no-install-recommends git
# Compile SOPE and SOGo
# Configuration SOPE:
#   FHS:    install in FHS root
#   debug:  yes
#   strip:  yes
#   prefix:     /usr/local/
#   frameworks:
#   gstep:      /usr/share/GNUstep/Makefiles
#   config:     /usr/src/app/sope/config.make
#   script:     /usr/share/GNUstep/Makefiles/GNUstep.sh
# Configuration SOGo:
#   debug:  yes
#   strip:  no
#   saml2 support:  no
#   mfa support:  no
#   argon2 support:  yes
#   ldap-based configuration:  no
#   prefix: /usr/Local
#   gstep:  /usr/share/GNUstep/Makefiles
#   config: /usr/src/app/sogo/config.make
#   script: /usr/share/GNUstep/Makefiles/GNUstep.sh
RUN git clone https://github.com/inverse-inc/sope.git \
    && cd sope && ./configure && make && make install && cd ..
#RUN git clone https://github.com/inverse-inc/sogo.git \
#    && cd sogo && ./configure && make && make install && cd ..
#RUN ldconfig --verbose \
#    && echo "/usr/local/lib/sogo" > /etc/ld.so.config.d/sogo.conf

#cp ~/src/sogo.service /lib/systemd/system/
#chown root:root /lib/systemd/system/sogo.service
#chmod 644 /lib/systemd/system/sogo.service
#rm /etc/systemd/system/sogo.service
#systemctl enable sogo
#systemctl start sogo

#COPY requirements.txt ./
#RUN pip install --no-cache-dir -r requirements.txt
#COPY . .
ENTRYPOINT ["/bin/bash"]
#CMD [ "python", "./your-daemon-or-script.py" ]