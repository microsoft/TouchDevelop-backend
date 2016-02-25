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
docker import base.tgz
```

```
sudo su - build
git clone https://github.com/Microsoft/TouchDevelop-backend.git 
```
