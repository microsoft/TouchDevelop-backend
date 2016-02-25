var http = require('http');
var child_process = require("child_process");
var async = require("async");
var crypto = require("crypto");
var fs = require("fs");
var domain = require("domain");
var azure = require("azure-storage");

var baseImg = "8b0c24a027fa4c041cab37d0368e8c9814bd50d5c3b937ebb000729af2660e33";
var res = child_process.spawnSync("docker", ["images", "-a", "--no-trunc"], { encoding: "utf8" })
var existingImg = {}
res.stdout.replace(/\s([0-9a-f]{30,})\s/g, function(v,i) {
    existingImg[i]=1
})
console.log(existingImg)

var cfg = JSON.parse(fs.readFileSync("config.json", "utf8"))

function err(res,code,msg)
{
    console.log("err: " + code + ": " + msg)
        res.writeHead(code); res.end(msg);
}

var key = new Buffer(cfg.key,"hex")

process.on('uncaughtException', function (err) {
    console.log(err);
})

var buildq = async.queue(function(f,cb){f(cb)}, 8)
function build(js, outp) {
   installAndBuild(js.image, function(cb) {
      var ch = child_process.spawn("docker", ["run", "--rm", "-i", "-u", "build", js.image || "379", "node", "/build/go.js"],
      { })
      ch.stdin.write(JSON.stringify(js))
      ch.stdin.end()
      ch.stdout.pipe(outp)

      ch.stderr.setEncoding("utf8")
      var nuke = ""
      ch.stderr.on("data", function(d) {
           var m = /Cannot destroy container ([0-9a-f]{20,})/.exec(d)
           if (m) {
                nuke = m[1]
           }else {
               console.log(d)
           }
      })
      ch.on("exit", function() { 
          cb(null) 
          if (nuke)
              setTimeout(function() {
               console.log("nuke container " + nuke)
                  var ch = child_process.spawn("docker", ["rm", nuke])
                  ch.stderr.pipe(process.stderr)
              }, 1000)
      })
   })
}

function installAndBuild(img, f) {
    if(!img || existingImg.hasOwnProperty(img)) buildq.push(f)
    else {
        updateq.push(function(cb) {
            if(existingImg.hasOwnProperty(img)) {
                buildq.push(f)
                return
            }

            console.log("install image " + img)

            var inp = svc.createReadStream(cfg.blobContainer, img + ".tgz", {}, function(err) {
                if (err) throw err;
            })
            var ch = child_process.spawn("docker", ["load"], { })
            inp.pipe(ch.stdin);
            ch.stdout.pipe(process.stdout)
            ch.stderr.pipe(process.stderr)
            ch.on("exit", function() {
                existingImg[img] = 1
                cb()
                buildq.push(f)
            })
        })
    }
}

var updateq = async.queue(function(f,cb){f(cb)}, 1)
function update(js,outp) {
    console.log("push update")
   updateq.push(function(cb) {
       var args = ["update"].concat(js.args||[])
       console.log("start update", args)
      var ch = child_process.spawn("./run", args, {})
      ch.stdout.setEncoding("utf8")
      ch.stderr.setEncoding("utf8")

      var out = ""

      ch.stdout.on("data", function(d) {
          out += d
      })

      ch.stderr.on("data", function(d) {
          out += d
      })

      ch.stdin.end()

      ch.on("exit", function() { 
          var m = /^IMGID ([0-9a-f]+)/m.exec(out)
          var r = { output: out }
          if (m) {
              console.log("stop update; " + m[1])
              r.imageid = m[1]
              var blobName = r.imageid + ".tgz"
              //var sasToken = svc.generateSharedAccessSignature(cfg.blobContainer, blobName, { AccessPolicy: { Expiry: azure.date.minutesFromNow(60); } });
              var sasUrl = svc.getUrl(cfg.blobContainer, blobName)
              r.url = sasUrl
              svc.createBlockBlobFromLocalFile(cfg.blobContainer, blobName, blobName, {}, function(err) {
                  if(err) throw err;
                  fs.unlink(blobName, function(){})
                  outp.end(JSON.stringify(r))
                  cb(null)
              })
          } else {
              console.log("stop update; failed")
              outp.end(JSON.stringify(r,null,1))
              cb(null)
          }
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
        err(res,403,"bad iv")
        return
    }

    var ciph = crypto.createDecipheriv("AES256", key, iv)
    ciph.setEncoding("utf8")
    var dd = ""
    ciph.on("data", function(d) { dd += d })
    ciph.on("end", function() {
        if (dd.length < 128) {
            err(res,403, "too short")
            return
        }
        try {
            var js = JSON.parse(dd)
        } catch (e) {
            err(res,403, "bad key")
            return
        }
        var oiv = crypto.randomBytes(16)
        res.setHeader("x-iv", oiv.toString("hex"))
        var enciph = crypto.createCipheriv("AES256", key, oiv)
        enciph.pipe(res);
        res.writeHead(200);

        if (js.op == "build")
            build(js, enciph)
        else if (js.op == "update")
            update(js, enciph)
        else
            enciph.end(JSON.stringify({err:"Wrong OP"}))
    })
    req.pipe(ciph)

}

function createService(acct, key) {
  var blob_service = azure.createBlobService(acct, key)

  var retryOperations = new azure.LinearRetryPolicyFilter(10, 1000);
  blob_service = blob_service.withFilter(retryOperations);

  var svc = blob_service;
  return svc
}

var svc = createService(cfg.blobAccount, cfg.blobKey);
svc.createContainerIfNotExists(cfg.blobContainer, { publicAccessLevel: "blob" }, function() {})

//update({}, process.stdout)
function upload(blobName)
{
    console.log("uploading " + blobName)
      svc.createBlockBlobFromLocalFile(cfg.blobContainer, blobName, blobName, {}, function(err) {
          if(err) throw err;
          console.log("uploaded.")
      })
}

if (process.env.UPLOAD) upload(process.env.UPLOAD)


http.createServer(function (req, res) {
    var d = domain.create();
    d.on('error', function(er) {
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
    d.run(function() { handleReq(req, res) })
      
}).listen(2424);
