N=tdlite

all:
	sh ./build.sh

docs: all
	PORT=4000 node built/templater.js serve
	
# requires TD_UPLOAD_KEY
upload:
	if [ "X$$TRAVIS_BRANCH" = "Xmaster" ] ; then node built/templater.js push ; fi

pxt:
	make -C ../pxt
	cp ../pxt/built/backendutils.js external/

