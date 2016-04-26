# Docker-based build scripts

## Setup

In `/etc/fstab` add:

```
tmpfs   /docker    tmpfs  rw,size=4G,nodev,noatime,mode=1700   0  0
```

Create `/etc/systemd/system/docker.service` with the following:

```
[Service]
ExecStart=
ExecStart=/usr/bin/docker daemon -H fd:// -g /docker
```

Then do:

```
mkdir /docker
mount -a
systemctl daemon-reload
systemctl restart docker
docker pull mmoskal/yotta
```

Install node.js (on host, not in docker):
```
curl -sL https://deb.nodesource.com/setup_4.x | bash -
apt-get install nodejs
```

Clone TD-backend repo:

```
sudo su - build
git clone https://github.com/Microsoft/TouchDevelop-backend.git
cd TouchDevelop-backend/dockerbuild
```

Copy `.yotta/config.json` with the right credentials to `yottaconfig.json`.

Run `node server.js` and create `config.json` file as prompted. 

Then run the server in screen session.
```
screen
node server.js
Ctrl-A Ctrl-D
```
