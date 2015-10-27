N=tdlite

all:
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
	PORT=4000 node built/templater.js
	
