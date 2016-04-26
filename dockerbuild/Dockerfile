# ------------------------------------------------------------------------------
# Pull base image
FROM mbed/yotta
MAINTAINER Michal Moskal <micmo@microsoft.com>

RUN apt-get install rlwrap

RUN curl https://deb.nodesource.com/node_4.x/pool/main/n/nodejs/nodejs_4.4.3-1nodesource1~trusty1_amd64.deb > node.deb \
 && dpkg -i node.deb \
 && rm node.deb

RUN apt-get install -y srecord

RUN useradd -m build

COPY go.js /home/build
