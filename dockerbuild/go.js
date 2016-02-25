var fs = require("fs")
var child_process = require("child_process")

process.stdin.setEncoding("utf8")
process.stdout.setEncoding("utf8")

var buf = ""
process.stdin.on("data", function(d) { buf += d })
process.stdin.on("end", function() {
    handle(JSON.parse(buf))
})

var protect = [process.env["HOME"] + "/.yotta"]

function setmod(m) {
    protect.forEach(function(n) { fs.chmodSync(n,m) })
}

function handle(req) {
    var rootdir = req.buildpath || "/build/microbit-touchdevelop"
    process.chdir(rootdir);
    protect.push(rootdir + "/.git");

    (req.files || []).forEach(function(f) {
        fs.writeFileSync(f.path, f.text)
    })
    if(req.maincpp) fs.writeFileSync("source/main.cpp", req.maincpp)
    process.chdir("build")
    process.chdir(req.target || "bbc-microbit-classic-gcc")
    var hex = req.hexfile || "source/microbit-touchdevelop-combined.hex"
    //if (fs.existsSync(hex)) fs.unlinkSync(hex)
    setmod("000")
    var res = child_process.spawnSync("ninja", [], { encoding: "utf8" })
    setmod("700")
    var resp = { 
        stdout: res.stdout,
        stderr: res.stderr,
        status: res.status,
    }
    if (res.status == 0 && fs.existsSync(hex))
        resp.hexfile = fs.readFileSync(hex, "utf8")

   process.stdout.write(JSON.stringify(resp, null, 1))
   process.stdout.write("\n")
}
