/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';
import * as util from 'util';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as azureTable from "./azure-table"
import * as azureBlobStorage from "./azure-blob-storage"
import * as zlib from 'zlib';

let cmds: any = {};
let helpMessage = "";

let tableClient: azureTable.Client;
let blobClient: azureBlobStorage.BlobService;

let isConsole = !!(<any>process.stdout).isTTY;

function fmt(n: string, len: number) {
    while (n.length < len - 1)
        n += " ";
    return n + " ";
}

function addCommand(name: string, args: string, cmdhelp: string, f: (args: string[]) => Promise<void>) {
    cmds[name] = f;
    helpMessage = helpMessage + fmt(name, 10) + fmt(args, 10) + cmdhelp + "\n";
}

function printHelp() {
    console.log("USAGE: node storutil COMMAND ARGS...")
    console.log("Commands:")
    console.log(helpMessage)
    process.exit(1)
}

let decodeHex = false;

function decode(s: string) {
    if (decodeHex)
        s = s.replace(/%([0-9A-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    // try { s = new Buffer(s, "base64").toString("hex");   } catch (e) { }
    return s;
}

addCommand("query", "table {count=N|part=S|row=S|cont=S|hex|line}", "list tables", async (args) => {
    let tblnm = args.shift()
    if (!tblnm) printHelp();
    let tbl = await tableClient.createTableIfNotExistsAsync(tblnm);
    let q = tbl.createQuery().pageSize(100);
    let oneline = false;
    while (args.length > 0) {
        let arg = args.shift();
        let m = /^count=(\d+)$/.exec(arg);
        if (m) { q = q.top(parseInt(m[1], 10)); continue; }
        m = /^cont=(.*)/.exec(arg);
        if (m) { q = q.continueAt(m[1]); continue; }
        m = /^part(=|==|!=|<|>|<=|>=)(.*)/.exec(arg);
        if (m) { q = q.where("PartitionKey", m[1], m[2]); continue; }
        m = /^row(=|==|!=|<|>|<=|>=)(.*)/.exec(arg);
        if (m) { q = q.where("RowKey", m[1], m[2]); continue; }
        if (arg == "hex") { decodeHex = true; continue; }
        if (arg == "line") { oneline = true; continue; }
        console.log("not understood:", arg)
        process.exit(1)
    }
    if (isConsole && q.onlyTop > 1000) q = q.top(20);
    while (true) {
        let fr = await q.fetchPageAsync();
        for (let item of fr.items) {
            var hd = decode(item["PartitionKey"]) + " / " + decode(item["RowKey"]) + " : ";
            delete item["PartitionKey"];
            delete item["RowKey"];
            delete item["Timestamp"];
            for (let k of Object.keys(item)) {
                if (/Compressed/.test(k) && Buffer.isBuffer(item[k])) {
                    item[k] = decompress(item[k])
                }
            }
            if (oneline) {
                for (let k of Object.keys(item)) {
                    hd += k + ": " + util.inspect(item[k]) + ", ";
                }
                console.log(hd)
            } else {
                console.log("****** " + hd)
                console.log(item)
                console.log("")
            }
        }
        if (isConsole) break;
        if (!fr.continuation) break;
        q = q.continueAt(fr.continuation);
    }
});

addCommand("containers", "[conttoken]", "list blob containers", async (args) => {
    blobClient.handle.listContainersSegmented(args[0], {}, (err, res) => {
        for (let t of res.entries) {
            console.log("container:", t.name)
        }
        let cont = res.continuationToken
        if (cont)
            console.log("continuation:", cont);
    })
});

addCommand("blobs", "container [prefix [cont]]", "list blob containers", async (args) => {
    blobClient.handle.listBlobsSegmentedWithPrefix(args[0], args[1] || "", args[2], { maxResults: 100 }, (err, res) => {
        for (let t of res.entries) {
            console.log("blob:", t.name)
        }
        let cont = res.continuationToken
        if (cont)
            console.log("continuation:", cont);
    })
});


addCommand("mirror", "container [prefix [cont]]", "list blob containers", async (args) => {
    let dir = "mirror"
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir)
    let container = blobClient.getContainer(args[0])
    blobClient.handle.listBlobsSegmentedWithPrefix(args[0], args[1] || "", args[2], { maxResults: 100 }, async (err, res) => {
        if (err) {
            console.log(err.message)
            return
        }
        for (let t of res.entries) {
            let res = await container.getBlobToBufferAsync(t.name)
            let fn = dir + "/" + t.name
            fs.writeFileSync(fn, res.buffer())
            console.log("wrote:", fn)
        }
        let cont = res.continuationToken
        if (cont) {
            console.log("continuation:", cont);
        }
    })
});

const idLength = 20

const digits = [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "A", "C", "D", "E", "F", "H", "J", "K", "L", "M",
    "P", "R", "T", "U", "V", "W", "X", "Y", "a", "b",
    "c", "d", "e", "f", "g", "h", "i", "j", "k", "m",
    "o", "p", "q", "r", "s", "t", "u", "v", "w", "x",
    "y", "z",
]

function decompressId(id: string) {
    id = id.replace(/B/g, "8")
        .replace(/G/g, "6")
        .replace(/I/g, "1")
        .replace(/l/g, "1")
        .replace(/O/g, "0")
        .replace(/Q/g, "D")
        .replace(/S/g, "5")
        .replace(/Z/g, "2")
        .replace(/n/g, "m")
        .replace(/N/g, "M")
        .replace(/_/g, "")
        .replace(/-/g, "")

    let r = ""

    for (let i = 0; i < id.length; i += 3) {
        let num = 0
        for (let j = 0; j < 3; ++j) {
            let idx = digits.indexOf(id.charAt(i + j))
            if (idx < 0) return null
            num = num * digits.length + idx
        }
        r += ("00000" + num).slice(-5)
    }
    return normalizeId(r)
}

export function normalizeId(id: string): string {
    if (id[0] == "_")
        return decompressId(id)
    id = id.replace(/[^0-9]/g, "")
    if (id.length != idLength) return null
    let r = ""
    for (let i = 0; i < id.length; i += 5) {
        if (i) r += "-"
        r += id.slice(i, i + 5)
    }
    return r
}

function blobId(id: string) {
    return crypto.pbkdf2Sync(id, "blobid", 10000, 32, "sha256").toString("hex")
}

function encKey(salt: Buffer, id: string) {
    return crypto.pbkdf2Sync(id, salt as any, 1000, 32, "sha256")
}

addCommand("decrypt", "id", "decrypt a backed-up script blob", async (args) => {
    let dir = "mirror"
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir)
    let id = normalizeId(args[0])
    if (!id) {
        console.log("invalid id")
        return
    }
    let bid = blobId(id)
    let fn = dir + "/" + bid
    if (!fs.existsSync(fn)) {
        let all = fs.readdirSync(dir)
        let base = all.filter(f => f.endsWith(bid))[0]
        if (base) fn = "mirror/" + base
        else {
            console.log("cannot find file: " + fn)
            return
        }
    }
    let buffer = fs.readFileSync(fn)
    let key = encKey(buffer.slice(0, 32), id)
    let cipher = crypto.createDecipher("AES256", key)
    let buf0 = cipher.update(buffer.slice(32))
    let buf1 = cipher.final()
    let scr = JSON.parse(Buffer.concat([buf0, buf1]).toString("utf8"))
    fs.writeFileSync("script.json", JSON.stringify(scr, null, 2))
    console.log("write script.json")
});


function decompress(buf: Buffer) {
    if (buf.length <= 1) return "";

    if (buf[0] == 0) {
        buf = buf.slice(1);
    } else if (buf[0] == 1 || buf[0] == 2) {
        let len = buf.readInt32LE(1);
        if (buf[0] == 1)
            buf = zlib.inflateRawSync(buf.slice(5));
        else
            buf = zlib.gunzipSync(buf.slice(5));
        assert(len == buf.length)
    } else {
        assert(false)
    }

    return buf.toString("utf8");
}

addCommand("getblob", "container path", "list blob containers", async (args) => {
    let cont = await blobClient.createContainerIfNotExistsAsync(args[0], "private");
    let r = await cont.getBlobToBufferAsync(args[1]);
    let buf = r.buffer();
    fs.writeFileSync("blob.bin", buf);
    fs.writeFileSync("blob.hex", buf.toString("hex"));
    if (true) {
        let json = [];
        if (buf.readInt32LE(0) == 1) {
            for (let pos = 4; pos < buf.length;) {
                if (!buf[pos++]) {
                    json.push(null);
                    continue;
                }

                let len = buf.readInt32LE(pos);
                pos += 4;
                console.log(len);
                json.push(decompress(buf.slice(pos, pos + len)))
                pos += len;
            }
        }
        fs.writeFileSync("blob.json", JSON.stringify(json, null, 2))
    }
    console.log("blob.bin written,", buf.length, "bytes")
});


addCommand("putblob", "container path", "put blob", async (args) => {
    let buf0 = fs.readFileSync(args[1])
    let cont = await blobClient.createContainerIfNotExistsAsync(args[0], "hidden");
    let r = await cont.createBlockBlobFromBufferAsync(args[1], buf0)
    console.log(r.succeded() ? "OK" : r.error())
});

addCommand("tables", "[cont]", "list tables", async (args) => {
    var opts = {
        nextTableName: args[0]
    }
    tableClient.handle.listTables(opts, (err, buf, cont) => {
        for (let t of buf) {
            console.log("table:", t)
        }
        if (cont)
            console.log("continuation:", cont);
    })
});

function init() {
    let connStr = process.env["AZURE_STORAGE_CONNECTION_STRING"]
    if (!process.env["AZURE_STORAGE_ACCESS_KEY"] && !connStr) {
        console.log("you need to set AZURE_STORAGE_CONNECTION_STRING or both AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_ACCESS_KEY environment variables");
        process.exit(1);
    }
    if (!connStr) {
        tableClient = azureTable.createClient();
        azureTable.assumeTablesExists();
    }
    azureBlobStorage.init();
    if (connStr) {
        blobClient = azureBlobStorage.createBlobService({
            connectionString: connStr
        });
    } else {
        blobClient = azureBlobStorage.createBlobService();
    }
    azureBlobStorage.assumeContainerExists();
}

function main() {
    let args = process.argv.slice(2);
    let cmd = args.shift();

    if (!cmd) printHelp();
    cmd = cmd.toLowerCase();
    if (!cmds.hasOwnProperty(cmd)) printHelp();

    init();
    cmds[cmd](args);
}

main();
