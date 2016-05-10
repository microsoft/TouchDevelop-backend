"use strict";

var crypto = require("crypto");
var azure = require("azure-storage");
var async = require("async");
var fs = require("fs");
var https = require("https")
var util = require("util")
var net = require("net")
var azureTable = require("azure-table-node")
var url = require("url")

var maxDl = 40
var maxBufSize = 8*1024*1024

var numWorkspaces = 4;

var tm = new Date();
var trgContainer = (9999999999999 - tm.getTime()) + "-" + tm.getFullYear() + "-" + (tm.getMonth() + 1) + "-" + tm.getDate()
var prevContainers = []

var totalWr = 0
var totalRd = 0

var logFile = "logs/" + trgContainer + ".txt"

var accounts = null

var excludedContainers = [
//"app",
"cachecompiler",
"cacherewritten",
"compile",
"crashes",
"embedthumbnails",
"mydeployments",
"tddeployments",
]

var publicBlobs = [
"aac",
"app",
"files",
"pub",
"thumb",
"thumb1",
"workspace",
]


var excludedTables = [
"historyslots",
"tokens",
]


var baseAccountName = ""
var accountNames = [
"microbit0",
"microbitws0",
"microbitws1",
"microbitws2",
"microbitws3",
"microbitwstab",
//"microbithist",
"microbitnot",
"mbitaudit",
]

var agent = new https.Agent({ maxSockets: maxDl, keepAlive: true });
https.globalAgent = new https.Agent({ maxSockets: maxDl, keepAlive: true });


function setupSocket(){
        var origConnect = net.Socket.prototype.connect
        net.Socket.prototype.connect = function (options) {
            if (options && typeof options.host == "string")
                this.tdHost = options.host
            return origConnect.apply(this, arguments)
        }

        var origDestroy = net.Socket.prototype._destroy
        net.Socket.prototype._destroy = function (exn) {
            if (typeof exn == "object" && (this.tdHost || this.tdUnrefed)) {
                if (!exn.tdMeta) exn.tdMeta = {}
                exn.tdMeta.socketHost = this.tdHost
                exn.tdMeta.unrefed = this.tdUnrefed

                if (this.tdUnrefed && exn.code == 'ECONNRESET') {
                    //log("ignoring ECONNRESET on " + this.tdHost)
                    exn.rtProtectHandled = true;
                    exn.tdSkipReporting = true;
                }
            }
            return origDestroy.apply(this, arguments)
        }

        var origRef = net.Socket.prototype.ref
        net.Socket.prototype.ref = function () {
            this.tdUnrefed = false
            return origRef.apply(this, arguments)
        }
        var origUnref = net.Socket.prototype.unref
        net.Socket.prototype.unref = function () {
            this.tdUnrefed = true
            return origUnref.apply(this, arguments)
        }

        process.on("uncaughtException", function(exn) {
                if (exn.rtProtectHandled) return
                logErr(exn, "top-level")
                process.exit(1)
        })
}

function hashString(str, enc) {
    var hash = crypto.createHash("sha256")
    hash.update(str)
    return hash.digest(enc)
}

var start = Date.now()

function log(msg) {
  var tm = ("00000000" + ((Date.now() - start)/1000).toFixed(2)).slice(-8)
  var mem = process.memoryUsage()
  //mem = (mem.heapTotal/(1024*1024)).toFixed(2) + "M, "
  mem = ("000" + (mem.heapUsed/(1024*1024)).toFixed(2) + "M").slice(-8)
  msg = "[" + tm + " - " + mem + "] " + msg
  console.log(msg)
  fs.appendFileSync(logFile, msg + "\n")
}

function readRes(g, f) {
    var bufs = [];
    g.on('data', function (c) {
        if (typeof c === "string")
            bufs.push(new Buffer(c, "utf8"));
        else
            bufs.push(c);
    });
    g.on('end', function () {
        var total = Buffer.concat(bufs);
        f(total);
    });
}

var vaultToken = "";
var vaultClientId = "";
var vaultSecret = "";
var vaultUrl = "";
var numRetries = 0;

function downloadSecret(uri, f) {
    var p = url.parse(uri + "?api-version=2015-06-01");
    p.headers = {};
    if (vaultToken)
        p.headers['Authorization'] = 'Bearer ' + vaultToken;
    log("vault: downloading secret from " + uri);
    var r = https.request(p, function (res) {
        if (res.statusCode == 401) {
            if (numRetries > 3) {
                f(new Error("too many retries"));
                return;
            }
            var m = /authorization="([^"]+)".*resource="([^"]+)"/.exec(res.headers['www-authenticate']);
            if (!m) {
                f(new Error("bad auth header, " + JSON.stringify(res.headers)))
                return;
            }
            var d = "grant_type=client_credentials" + 
              "&client_id=" + encodeURIComponent(vaultClientId) + 
              "&client_secret=" + encodeURIComponent(vaultSecret) + 
              "&resource=" + encodeURIComponent(m[2]);
            var pp = url.parse(m[1] + "/oauth2/token");
            pp.headers = {
                'Content-Type': 'application/x-www-form-urlencoded'
            };
            pp.method = 'POST';
            //console.log(pp, d)
            var r = https.request(pp, function (res) {
                readRes(res, function (total) {
                    if (res.statusCode != 200) {
                        log("status: " + res.statusCode);
                        console.log(res.headers)
                        log(total.toString("utf8"));
                        f(new Error("get token failed for " + uri))
                        return;
                    }
                    var j = JSON.parse(total.toString("utf8"));
                    vaultToken = j.access_token;
                    numRetries++;
                    downloadSecret(uri, f);
                });
            });
            r.end(d);
        }
        else {
            numRetries = 0;
            readRes(res, function (total) {
                if (res.statusCode != 200) {
                    error.log(total.toString("utf8"));
                    f(new Error("get failed for " + uri))
                    return;
                }
                else {
                    var d = JSON.parse(total.toString("utf8"));
                    log("vault: got secret, " + (d && d.value ? d.value.length : "<nil>"));
                    f(null, JSON.parse(d.value));
                }
            });
        }
    });
    r.end();
}
function createService(acct, key) {
  var blob_service = azure.createBlobService(acct, key)

  var retryOperations = new azure.LinearRetryPolicyFilter(10, 1000);
  blob_service = blob_service.withFilter(retryOperations);

  var svc = blob_service;
  // hack to keep sockets open (EADDRINUSE error)
  var prev = svc._buildRequestOptions;
  svc._buildRequestOptions = function (wr, bd, opt, cb) {
    prev.apply(this, [wr, bd, opt, function (err, opts) {
       if (opts) {
         opts.agent = agent
         if (opt.timeoutIntervalInMs)
            opts.timeout = opt.timeoutIntervalInMs; 
       }
       cb(err, opts);
    }]);
  };

  return svc
}

function createTableService(acct, key) {
  var opts = {
      accountName: acct,
      accountKey: key,
      accountUrl: "https://" + acct + ".table.core.windows.net/",
      agent: agent,
  }

  return azureTable.createClient(opts)
}

var trg, dataKey

function bad(err, cb) {
  if (err) {
    logErr(err, "bad-handler")
    cb(err)
    return true
  }
  return false
}

function listBlobs(st, cb) {
  st.entries = {}
  var tot = 0

  if (st.container == "workspace") {
      var id = st.account[st.account.length - 1]
      getBlob(trg, trgContainer, "workspaceidx" + id, function(err,buf) {
       if (bad(err, cb)) return
        buf = buf.toString("utf8")
        buf = JSON.parse(buf)
        st.entries = buf
        st.workspace = true
        st.total = Object.keys(buf).length
        cb(null)
      })
      return
  }

  var isApp = st.container == "app"

  function loop() {
    st.svc.listBlobsSegmented(st.container, st.ct, { 
        maxResults: isApp ? 3000 : 5000,
        include: "metadata"
    }, function(err, resp) {
       if (bad(err, cb)) return
       tot += resp.entries.length
       st.total = tot
       var last = ""
       var len = 0
       var tmp = []
       resp.entries.forEach(function (it) {
         len += 64 + it.name.length * 2 + it.properties.etag.length * 2
         tmp.push(it.name)
         tmp.push(it.properties.etag)
         last = it.name
       })
       // without the re-parse we get a memory leak; go figure
       tmp = JSON.parse(JSON.stringify(tmp))
       for (var i = 0; i < tmp.length; i += 2)
           st.entries[tmp[i]] = tmp[i+1]
       //global.gc();
       log("list blobs, " + tot + " entries; last " + last + "; " + len)
       st.ct = isApp ? null : resp.continuationToken
       resp = null
       if (st.ct) process.nextTick(loop)
       else cb(null)
    })
  }
  st.ct = null
  loop()
}

function makeEntry(buf, info, httpres)
{
  return {
    name: info.blob,
    etag: info.etag.replace(/"/g, ""),
    lastModified: info.lastModified,
    contentType: info.contentType,
    content: buf.toString("base64"),
    contentEncoding: info.contentEncoding,
    cacheControl: info.cacheControl,
  }
}

function addEntries(st, es, cb) {
    es.forEach(function(e) {
      delete st.entries[e.name]
      st.buf.push(e)
      st.bufSize += e.content.length + 500
    })
    if (st.bufSize > maxBufSize) flushBuf(st, cb)
    else cb(null)
}

function dlEntry(st, name, cb) {
  getBlob(st.svc, st.container, name, function(err, buf, info, httpres) {
    if (bad(err, cb)) return
    var e = makeEntry(buf, info, httpres)
    addEntries(st, [e], cb)
  })
}

function retry(f, cb) {
  async.retry({ times: 30, interval: 2000 }, f, cb)
}

function putBigBlob(svc, container, fn, data, opts, cb)
{
  var stream = svc.createWriteStreamToBlockBlob(container, fn, opts, cb)
  totalWr += data.length + 2000
  //stream.on("error", function(e) { cb(e) })
  if (/\.enc$/.test(fn)) {
      var iv = hashString(fn).slice(0, 16)
      var cipher = crypto.createCipheriv("aes256", dataKey, iv) 
      cipher.pipe(stream)
      cipher.write(data)
      cipher.end()
  } else {
      stream.write(data)
      stream.end()
  }
}

function gb(n) {
    return (n / (1024*1024*1024)).toFixed(3) + "GB"
}

function datastat()
{
    var sec = (Date.now() - tm)/1000
    return "r:" + gb(totalRd) + " w:" + gb(totalWr) + " " + ((totalRd + totalWr) / (1024*1024/8) / sec).toFixed(1) + "Mbit"
}

function flushBuf(st, cb) {
  if (!st.buf || st.buf.length == 0) {
    cb(null)
    return
  }
  var len = st.buf.length
  st.flushed += len
  var data = JSON.stringify(st.buf,null,1)
  data = new Buffer(data, "utf8")
  st.buf = []
  st.bufSize = 0
  var fn = st.prefix + st.fileNo++ + "." + crypto.randomBytes(8).toString("hex") + ".enc"
  st.newStatus.files.push(fn)
  log("flushing " + fn + " with " + len + " entries; " + (st.flushed*100/st.total).toFixed(2) + "%; " + datastat())
  retry(function(cb) { 
        putBigBlob(trg, trgContainer, fn, data, { storeBlobContentMD5: false }, cb)
  }, function(err,res) {
    //log("done flushing " + fn)
    cb(err,res)
  })
}

function restoreEntries(st, cb) {
  log("restoring table " + st.prevStatus.files.length + " collations")
  async.eachSeries(st.prevStatus.files, function(fn, cb) {
    log("downloading " + fn)
    getBlob(trg, st.prevStatusContainer, fn, function(err, buf, info) {
      if (bad(err,cb)) return

      buf = buf.toString("utf8")
      buf = JSON.parse(buf)

      log("Handling previous file: " + st.prevStatusContainer + "/" + fn + "; " + buf.length)

      var jobs = []
      for (var i = 0; i < buf.length; ++i) (function() {
          var j = i + 1;
          var end = Math.min(i + 90, buf.length)
          while (j < end && buf[i].PartitionKey === buf[j].PartitionKey) {
              j++;
          }
          var len = j - i;
          var i0 = i;
          if (len > 3) {
              jobs.push(function(cb) {
                  var b = st.svc.startBatch()
                  while (i0 < j)
                      b.insertOrReplaceEntity(st.container, buf[i0++])
                  b.commit(cb)
              })
              i = j - 1;
          } else {
              jobs.push(function(cb) { st.svc.insertOrReplaceEntity(st.container, buf[i0], cb) })
          }
      }())

      async.parallelLimit(jobs, maxDl, cb)
    })
  }, cb)
}

function restoreFiles(st, cb) {
  log("restoring " + st.prevStatus.files.length + " collations")
  async.eachSeries(st.prevStatus.files, function(fn, cb) {
    log("downloading " + fn)
    getBlob(trg, st.prevStatusContainer, fn, function(err, buf, info) {
      if (bad(err,cb)) return

      buf = buf.toString("utf8")
      buf = JSON.parse(buf)

      log("Handling previous file: " + st.prevStatusContainer + "/" + fn + "; " + buf.length)

      async.eachLimit(buf, maxDl, function (v, cb) {
          retry(function(cb) {
              var data = new Buffer(v.content, "base64")
              putBigBlob(st.svc, st.container, v.name, data, {
                contentType: v.contentType,
                contentEncoding: v.contentEncoding,
                cacheControl: v.cacheControl,
              }, cb)
          }, cb)
      }, cb)
    })
  }, cb)
}

function updatePrevious(st, cb) {
  async.eachSeries(st.prevStatus.files, function(fn, cb) {
    log("downloading " + fn)
    getBlob(trg, st.prevStatusContainer, fn, function(err, buf, info) {
      if (bad(err,cb)) return

      buf = buf.toString("utf8")
      buf = JSON.parse(buf)
      var len0 = buf.length || 1
      var jobs = []
      var drop = 0

      buf = buf.filter(function(v) {
        if (st.entries.hasOwnProperty(v.name)) {
          if (st.entries[v.name] !== 1 && v.etag != st.entries[v.name]) {
            jobs.push(function(cb) {
              dlEntry(st, v.name, cb)
            })
            return false
          } else {
            return true
          }
        } else {
          drop++
          return false
        }
      })

      function fmt(v, m) { return (v*100 / len0).toFixed(1) + "% " + m + " " }


      log("Handling previous file: " + st.prevStatusContainer + "/" + fn + "; " + len0 + " entries; " + 
            fmt(buf.length, "keep") +
            fmt(drop, "drop") +
            fmt(jobs.length, "reget"))
      //log("To download: " + jobs.length + "; keep " + buf.length)

      addEntries(st, buf, function(err) {
        if (bad(err,cb)) return
        async.parallelLimit(jobs, maxDl, cb)
      })
    })
  }, cb)
}

function fetchNew(st, cb) {
  var newEntries = Object.keys(st.entries)
  log("downloading new entries, " + newEntries.length)
  async.eachLimit(newEntries, maxDl, function(id, cb) {
    dlEntry(st, id, cb)
  }, cb)
}

var backups = []

function saveStatus(st, cb) {
    backups.push({
            account: st.account,
            container: st.container,
            total: st.total,
            istable: st.newStatus.istable,
          })
  trg.createBlockBlobFromText(trgContainer, st.prefix + "status.json", JSON.stringify(st.newStatus), cb)
}

function saveFinal(cb) {
  trg.createBlockBlobFromText(trgContainer, "0final.json", JSON.stringify(backups), cb)
}

function listContainers(svc, cb) {
    var res = []
    function loop(ct) {
        svc.listContainersSegmented(ct, { maxResults: 100 }, function(err, resp) {
            if (bad(err,cb)) return
            resp.entries.forEach(function(container) { res.push(container.name) })
            ct = resp.continuationToken
            if (ct) loop(ct)
            else cb(null, res)
        })
    }
    loop(null)
}

function listTables(svc, cb) {
    var res = []
    function loop(ct) {
        svc.listTables({ nextTableName: ct }, function(err, resp, ct) {
            if (bad(err,cb)) return
            resp.forEach(function(container) { res.push(container) })
            if (ct) loop(ct)
            else cb(null, res)
        })
    }
    loop(null)
}

function mkst(svc, name, container) {
          var st = {
            svc: svc,
            account: name,
            container: container,
            buf: [],
            bufSize: 0,
            total: 1,
            flushed:0,
            fileNo: 100000,
          }
  st.newStatus = {
    files: []
  }
  st.newStatus.istable = !!svc.createTable
  st.prefix = st.account + "-" + st.container + "-"
  return st
}

function restoreContainer(origname, newname, container, cb) {
  if (origname == newname) throw new Error()
  var key = accounts[newname]
  var svc = createService(newname, key)
  var st = mkst(svc, origname, container)
  var opts = {}
  if (publicBlobs.indexOf(container) != -1)
      opts = { publicAccessLevel: "blob" }
  async.series([
    function(cb) { findPreviousStatusFile(st, cb) },
    function(cb) { st.svc.createContainerIfNotExists(st.container, opts, cb) },
    function(cb) { restoreFiles(st, cb) },
  ], cb)
}

function restoreTable(origname, newname, table, cb) {
  if (origname == newname) throw new Error()
  var key = accounts[newname]
  var svc = createTableService(newname, key)
  var st = mkst(svc, origname, table)
  async.series([
    function(cb) { findPreviousStatusFile(st, cb) },
    function(cb) { st.svc.createTable(st.container, { ignoreIfExists: true }, cb) },
    function(cb) { restoreEntries(st, cb) },
  ], cb)
}

function backupTable(st, cb) {
    function loop(ct) {
        st.svc.queryEntities(st.container, { continuation: ct }, function (err, data, ct) {
            if(bad(err,cb)) return
            data.forEach(function(e) {
              st.buf.push(e)
              st.bufSize += JSON.stringify(e).length + 10

              if (st.workspace && e.currentBlob) {
                  if (/^-/.test(e.currentBlob))
                      return;
                  var m = /^\d+\.([a-z]+)\..*$/.exec(e.currentBlob)
                  if(!m){
                      log("bad blob " + e.currentBlob)
                      return;
                  }
                  var uid = m[1]
                  var id = uid.charCodeAt(uid.length - 1) % numWorkspaces
                  st.workspace[id][e.currentBlob] = 1
              }
            })

            if (st.bufSize > maxBufSize)
                flushBuf(st, function(err){
                    if (err) {
                        logErr(err, "flush")
                        process.exit(1)
                    }
                })

            if (ct) loop(ct)
            else cb(null)
        })
    }
    loop(null)
}

var wsSaved = false

function saveWorkspace(st, cb) {
      if (!st.workspace) { cb(null); return }
      if (wsSaved) {
          throw new Error("saving ws twice!")
      }
      wsSaved = true
      async.eachSeries(st.workspace, function(dt, cb) {
          var id = dt.__id
          delete dt.__id
          var buf = new Buffer(JSON.stringify(dt), "utf8")
          log("saving workspaceidx " + id)
          putBigBlob(trg, trgContainer, "workspaceidx" + id, buf, { storeBlobContentMD5: false }, cb)
      }, cb)
}

function backupTableAccount(name, cb) {
  log("backup table acct " + name)
  var svc = createTableService(name, accounts[name])
  listTables(svc, function(err, tbls) {
    if (bad(err, cb)) return
    tbls = tbls.filter(function(t) { return excludedTables.indexOf(t) == -1 && !/^WADM/.test(t) })
    async.each(tbls, function(tbl,cb) {
       var st = mkst(svc, name, tbl)
       st.total = 100000
       if (tbl == "installslots") {
           st.workspace = []
           for (var i = 0; i < numWorkspaces; ++i) st.workspace.push({ "__id" : i })
        }
       async.series([
            function(cb) { backupTable(st, cb) },
            function(cb) { flushBuf(st, cb) },
            function(cb) { saveWorkspace(st, cb) },
            function(cb) { saveStatus(st, cb) },
        ], cb)
    }, cb)
  })
}

function backupAccount(name, cb) {
  log("backup blob acct " + name)
  var key = accounts[name]
  var svc = createService(name, key)
  listContainers(svc, function(err, resp) {
    if (bad(err, cb)) return
    var jobs = []
    resp.forEach(function(container) {
        if (/^cache/.test(container) || excludedContainers.indexOf(container) >= 0) return
        jobs.push(function(cb) {
          var st = mkst(svc, name, container)
          async.series([
            function(cb) { findPreviousStatusFile(st, cb) },
            function(cb) { listBlobs(st, cb) },
            function(cb) { updatePrevious(st, cb) },
            function(cb) { fetchNew(st, cb) },
            function(cb) { flushBuf(st, cb) },
            function(cb) { saveStatus(st, cb) },
            function(cb) { st.entries = {}; cb(null) },
          ], cb)
        })
    })

    async.series(jobs, cb)
  })
}

function getBlobCore(svc, container, blob, cb) {
  var res, resp
  var rs = svc.createReadStream(container, blob, {}, function(err, _res, _resp) {
    res = _res
    resp = _resp
    if (bad(err,cb)) return
    cb(null, [Buffer.concat(bufs), res, resp])
  })
  var bufs = []
  rs.on("error", function(err) { log("error downloading " + blob + "; " + err); cb(err) })

  if (/\.enc$/.test(blob)) {
      var iv = hashString(blob).slice(0, 16)
      var cipher = crypto.createDecipheriv("aes256", dataKey, iv) 
      rs.pipe(cipher)
      rs = cipher
  }
  rs.on("data", function(d) { bufs.push(d); })
  rs.on("end", function() { })
}

function getBlob(svc, container, blob, cb) {
  retry(function(cb) { getBlobCore(svc, container, blob, cb) }, function(err,res) {
    if(bad(err,cb)) return
    if (res[0]) totalRd += res[0].length + 2000
    cb(err,res[0],res[1],res[2])
  })
}

/*
function putBlob(svc, container, blob, content, opts, cb) {
  if (typeof content == "string")
    content = new Buffer(content, "utf8")
  svc._putBlockBlob(container, blob, buf, null, buf.length, opts, cb)
}
*/

function findPreviousFinalFile(cb) {
  function loop(i) {
    if (!prevContainers[i]) {
      log("No previous final file found")
      cb(new Error("not found"), null)
      return
    }
    trg.getBlobToText(prevContainers[i], "0final.json", {},
      function (err, text, info, resp) {
        if (err) loop(i+1)
        else {
          log("Found prev at " + prevContainers[i])

          cb(null, { container: prevContainers[i],
                     final: JSON.parse(text) })
        }
      })
  }
  loop(0)
}

function findPreviousStatusFile(st, cb) {
  function loop(i) {
    if (!prevContainers[i]) {
      log("No previous status found for " + st.prefix)
      st.prevStatus = {
        files: []
      }
      cb(null)
      return
    }
    trg.getBlobToText(prevContainers[i], st.prefix + "status.json", {},
      function (err, text, info, resp) {
        if (err) loop(i+1)
        else {
          log("Found status at " + prevContainers[i] + "/" + st.prefix)
          st.prevStatus = JSON.parse(text)
          st.prevStatusContainer = prevContainers[i]
          cb(null)
        }
      })
  }
  loop(0)
}

function restore(newpref, cb) {
   findPreviousFinalFile(function(err, dat) {
       if(bad(err,cb)) return
       async.eachSeries(dat.final,
        function(info, cb) {
            var origname = info.account
            var newname = info.account.replace(/^microbit(0?)/, newpref)
            if (baseAccountName) newname = origname.replace(baseAccountName, newpref)
            if (newname == "mbitaudit") newname = newpref + "audit"
            if (origname == newname) throw new Error("same name")
            if (!accounts[newname]) throw new Error("no key for " + newname)
            log("restore " + origname + "/" + info.container)
            if (info.istable) restoreTable(origname, newname, info.container, cb)
            else restoreContainer(origname, newname, info.container, cb)
        }, cb)
   })
}

function containerTime(name) {
    var m = /^(\d\d\d\d\d\d\d+)-\d\d\d\d-\d+-\d+$/.exec(name)
    if(!m) return null;

    var n = parseInt(m[1])
    if (isNaN(n)) return null;

    return 9999999999999 - n;
}

function isOld(name) {
    var t = containerTime(name)
    if (t == null) return false;
    return (tm.getTime() - t > 30*24*3600*1000);
}

function delContainer(name, cb)
{
    log("Delete old container: " + name)
    trg.deleteContainer(name, function(err,res) {
       if (bad(err, cb)) return
       cb(null)
    })
}

function main(cb) {
  listContainers(trg, function(err, resp) {
    prevContainers = resp.slice(0, 20)
    log("Recent containers: " + prevContainers.join(", "))

    // we keep at least 30
    var todel = resp.slice(30).filter(isOld)
    // we don't delete more than 5 at a time
    todel = todel.slice(0,5)
    log("Containers to clean: " + todel.join(", "))

    if (process.env['RESTORE_BACKUP']) {
        restore(process.env['RESTORE_BACKUP'], cb)
        return
    }

    trg.createContainer(trgContainer, {}, function(err) {
      if(bad(err, cb)) return

      async.series([
        function(cb) { async.each(accountNames, backupTableAccount, cb) },
        function(cb) { async.eachSeries(accountNames, backupAccount, cb) },
        function(cb) { saveFinal(cb) },
        function(cb) { async.each(todel, delContainer, cb) },
      ], cb)
    })
  })
}


function logErr(err, msg) {
    if (!msg) msg = "ERROR"
    else msg += " ERROR"
    log(msg + ": " + err)
    log(util.inspect(err))
    log(err.stack)
}

function finalCb(err) {
  if (err) logErr(err, "final")
  else log("ALL OK");
  log("data: " + datastat())
  log("done; " + new Date().toString())
}

function setupKeys(cb) {
    readRes(process.stdin, function(buf) {
        var env = JSON.parse(buf.toString("utf8"))
        var keyUrl = env.KEY_VAULT_URL
        vaultClientId = env.KEY_VAULT_CLIENT_ID;
        vaultSecret = env.KEY_VAULT_CLIENT_SECRET;
        accounts = env.accounts || {}
        trg = createService(env.BACKUP_ACCOUNT, env.BACKUP_KEY)
        dataKey = hashString(env.ENCKEY_BACKUP0)

        downloadSecret(keyUrl, function(err,env) {
            if(bad(err,cb))return;

            if (env["AZURE_STORAGE_ACCOUNT"] != "microbit0") {
                baseAccountName = env["AZURE_STORAGE_ACCOUNT"]
                accountNames = [
                    env["AUDIT_BLOB_ACCOUNT"],
                    env["AZURE_STORAGE_ACCOUNT"],
                    env["NOTIFICATIONS_ACCOUNT"],
                    env["WORKSPACE_ACCOUNT"],
                    env["WORKSPACE_BLOB_ACCOUNT0"],
                    env["WORKSPACE_BLOB_ACCOUNT1"],
                    env["WORKSPACE_BLOB_ACCOUNT2"],
                    env["WORKSPACE_BLOB_ACCOUNT3"],
                ]
            }

            Object.keys(env).forEach(function(k) {
                var k2 = k.replace("ACCOUNT", "KEY")
                if (k != k2) {
                    accounts[env[k]] = env[k2]
                    if (!env[k2])
                        accounts[env[k]] = env[k.replace("ACCOUNT", "ACCESS_KEY")]
                }
            })

            cb(null)
        })
    })
}

log("start backup; " + new Date().toString())
setupSocket()

async.series([ 
    setupKeys, 
    main,
], finalCb)

// vim: ai
