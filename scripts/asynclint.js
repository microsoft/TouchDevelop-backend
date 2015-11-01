"use strict";
var fs = require('fs');
var numerr = 0;
process.argv.slice(2).forEach(fn => {
    let lineNo = 0;
    fs.readFileSync(fn, "utf8").split(/\r?\n/).forEach(ln => {
        lineNo++;
        if (/^\s*(export\s+)?(async\s+)?function\s+/.test(ln)) return;
        if (/^\s*(public|private|static)\s+/.test(ln)) return;
        for (var i = 0; i < 5; ++i)
            ln = ln.replace(/(return|await|\/\* async \*\/)\s+(.*?)?\w+Async\(/, " [...snip...] ")
        if (/Async\(/.test(ln)) {
            console.log(`${fn}:${lineNo}: ${ln}`)
            numerr++
        }
    })
})

if (numerr) process.exit(1)

// vim: ts=4 sw=4
