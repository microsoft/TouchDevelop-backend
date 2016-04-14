N=tdlite

all:
	sh ./build.sh

docs: all
	PORT=4000 node built/templater.js serve
	
# requires TD_UPLOAD_KEY
upload:
	node built/templater.js push

pxt:
	make -C ../pxt
	cp ../pxt/built/backendutils.js external/

