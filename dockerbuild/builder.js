"use strict";

var fs = require("fs")
var child_process = require("child_process")

process.stdout.setEncoding("utf8")

function handle(req) {
    let rootdir = req.buildpath || "/home/build/microbit-touchdevelop";
    process.chdir(rootdir);
    let modulejson = "";
    (req.files || []).forEach(function(f) {
        if (f.name == "module.json") modulejson = f.text;
    })
    if (modulejson) {
        fs.writeFileSync("module.json", modulejson)
    }
    let cmd = `git pull --tags && git checkout ${req.gittag} && yotta update`
    let res = child_process.spawnSync("bash", ["-c", cmd], { encoding: "utf8" })
    let resp = { 
        stdout: res.stdout || "",
        stderr: res.stderr || "",
        status: res.status,
    }

    if (res.status == 0) {
        fs.unlinkSync(process.env["HOME"] + "/.yotta/config.json");
        (req.files || []).forEach(function(f) {
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
