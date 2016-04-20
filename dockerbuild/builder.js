"use strict";

var fs = require("fs")
var path = require("path")
var child_process = require("child_process")

process.stdout.setEncoding("utf8")


function mkdirP(thePath) {
    if (thePath == ".") return;
    if (!fs.existsSync(thePath)) {
        mkdirP(path.dirname(thePath))
        fs.mkdirSync(thePath)
    }
}

function handle(req) {
    if (req.empty && !req.buildpath)
        req.buildpath = "/home/build/prj2"
    let rootdir = req.buildpath || "/home/build/microbit-touchdevelop";
    if (!fs.existsSync(rootdir))
        fs.mkdirSync(rootdir)
    process.chdir(rootdir);
    let modulejson = "";
    (req.files || []).forEach(function(f) {
        if (f.name == "module.json") modulejson = f.text;
    })
    if (modulejson) {
        fs.writeFileSync("module.json", modulejson)
    }
    let cmd = `git pull --tags && git checkout ${req.gittag} && yotta update`
    if (req.empty)
        cmd = `yotta target ${req.target} && yotta update`
    let res = child_process.spawnSync("bash", ["-c", cmd], { encoding: "utf8" })
    let resp = {
        stdout: res.stdout || "",
        stderr: res.stderr || "",
        status: res.status,
    }

    if (res.status == 0) {
        fs.unlinkSync(process.env["HOME"] + "/.yotta/config.json");
        (req.files || []).forEach(function(f) {
            mkdirP(path.dirname(f.name))
            fs.writeFileSync(f.name, f.text);
        })
        res = child_process.spawnSync("yotta", ["build"], { encoding: "utf8" });
        resp.stdout += res.stdout || ""
        resp.stderr += res.stderr || ""
        resp.status = res.status

        if (res.status == 0) {
            process.chdir("build")
            process.chdir(req.target || "bbc-microbit-classic-gcc")
            let hex = req.hexfile || "source/microbit-touchdevelop-combined.hex"
            if (fs.existsSync(hex))
                resp.hexfile = fs.readFileSync(hex, "utf8")
        }
    }

    process.stdout.write(JSON.stringify(resp, null, 1))
    process.stdout.write("\n")
}

handle(global.buildReq)
