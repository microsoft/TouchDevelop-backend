"use strict";

var http = require('http');
var child_process = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var domain = require("domain");
var async = require("async");

if (!fs.existsSync("config.json")) {
    var cfg = {
        key: crypto.randomBytes(32).toString("hex")
    };
    console.log("Please create config.json, for example one like this:")
    console.log(JSON.stringify(cfg, null, 4))
    process.exit(1)
}

var cfg = JSON.parse(fs.readFileSync("config.json", "utf8"))

function err(res, code, msg) {
    console.log("err: " + code + ": " + msg)
    res.writeHead(code); res.end(msg);
}

var key = new Buffer(cfg.key, "hex")

process.on('uncaughtException', function (err) {
    console.log(err);
})

var builderJs = fs.readFileSync("builder.js", "utf8")

var buildq = async.queue(function (f, cb) { f(cb) }, 8)
function build(js, outp) {
    buildq.push(function (cb) {
        console.log("Build")
        var ch = child_process.spawn("docker", [
            "run", "--rm", "-i",
            "-w", "/home/build", "-u", "build",
            js.image || "1647",
            "sh", "-c", "node go.js 2>&1"],
            {})
        js.builderJs = builderJs
        ch.stdin.write(JSON.stringify(js))
        ch.stdin.end()
        ch.stdout.pipe(outp)

        ch.stderr.setEncoding("utf8")
        var remove = ""
        ch.stderr.on("data", function (d) {
            var m = /Cannot destroy container ([0-9a-f]{20,})/.exec(d)
            if (m) {
                remove = m[1]
            } else {
                console.log(d)
            }
        })
        ch.on("exit", function () {
            cb(null)
            if (remove)
                setTimeout(function () {
                    console.log("remove container " + remove)
                    var ch = child_process.spawn("docker", ["rm", remove])
                    ch.stderr.pipe(process.stderr)
                }, 1000)
        })
    })
}

function handleReq(req, res) {
    console.log(req.url)
    var iv = req.headers["x-iv"]
    if (!iv) {
        err(res, 403, "No iv")
        return
    }
    iv = new Buffer(iv.replace(/\s+/g, ""), "hex")
    if (!iv || iv.length != 16) {
        err(res, 403, "bad iv")
        return
    }

    var ciph = crypto.createDecipheriv("AES256", key, iv)
    ciph.setEncoding("utf8")
    var dd = ""
    ciph.on("data", function (d) { dd += d })
    ciph.on("end", function () {
        if (dd.length < 128) {
            err(res, 403, "too short")
            return
        }
        try {
            var js = JSON.parse(dd)
        } catch (e) {
            err(res, 403, "bad key")
            return
        }
        var oiv = crypto.randomBytes(16)
        res.setHeader("x-iv", oiv.toString("hex"))
        var enciph = crypto.createCipheriv("AES256", key, oiv)
        enciph.pipe(res);
        res.writeHead(200);

        if (js.op == "buildex")
            build(js, enciph)
        else
            enciph.end(JSON.stringify({ err: "Wrong OP" }))
    })
    req.pipe(ciph)
}

if (process.argv[2]) {
    let f = fs.readFileSync(process.argv[2], "utf8");
    build(JSON.parse(f), process.stdout)
} else {
    http.createServer(function (req, res) {
        var d = domain.create();
        d.on('error', function (er) {
            console.error('error', er.stack);
            try {
                res.statusCode = 500;
                res.setHeader('content-type', 'text/plain');
                res.end();
            } catch (e) {
            }
        })
        d.add(req);
        d.add(res);
        d.run(function () { handleReq(req, res) })

    }).listen(2424);
}
