N=tdlite

all:
	cp external/backendutils.js built/
	node scripts/asynclint.js src/*.ts
	node node_modules/typescript/bin/tsc
	#node c:/dev/typescript/built/local/tsc

conv:
	cd .. && jake
	rm -f out.ts
	node ../build/noderunner.js ts td/$(N).td
	cat prelude.ts out.ts > src/$(N).ts
	rm -f out.ts
	$(MAKE) all

docs: all
	PORT=4000 node built/templater.js serve
	
# requires TD_UPLOAD_KEY
upload:
	node built/templater.js push

ks:
	make -C ../kindscript
	cp ../kindscript/built/backendutils.js external/
