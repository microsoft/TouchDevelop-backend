"use strict";

var fs = require("fs")
var child_process = require("child_process")

process.stdout.setEncoding("utf8")

function handle(req) {
    let rootdir = req.buildpath || "/home/build/microbit-touchdevelop";
    process.chdir(rootdir);
    if (req.modulejson) {
        fs.writeFileSync("module.json", req.modulejson)
    }
    let res = child_process.spawnSync("yotta", ["update"], { encoding: "utf8" })
    let resp = { 
        stdout: res.stdout || "",
        stderr: res.stderr || "",
        status: res.status,
    }

    if (res.status == 0) {
        fs.unlinkSync(process.env["HOME"] + "/.yotta/config.json");
        (req.files || []).forEach(function(f) {
            fs.writeFileSync(f.path, f.text);
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
