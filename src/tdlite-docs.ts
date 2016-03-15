/// <reference path='../typings/node/node.d.ts' />
/// <reference path='../typings/marked/marked.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';
import * as marked from 'marked';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;

var expandInfo: td.Action1<JsonBuilder>;

var boxes: td.SMap<string> = {
    hide: "<div style='display:none'>@BODY@</div>",
    avatar: `
<div class='avatar @ARGS@'>
  <div class='avatar-image'></div>
  <div class='ui message'>
    @BODY@
  </div>
</div>`,
    hint: `
<div class="ui icon green message">
  <i class="help checkmark icon"></i>
  <div class="content">
    <div class="header">Hint</div>
    @BODY@
  </div>
</div>`,
    column: `
<!-- COLUMN -->
<div class='column'>
  @BODY@
</div>
<!-- ENDCOLUMN -->
`,
}


export function renderMarkdown(src: string): td.SMap<string> {
    let res: td.SMap<string> = {}

    let html = marked(src, {
        sanitize: true,
        smartypants: true,
    })

    let endBox = ""

    let error = (s: string) =>
        `<div class='ui negative message'>${s}</div>`
    html = html.replace(/<h\d[^>]+>\s*([~@])\s*(.*?)<\/h\d>/g, (f, tp, body) => {
        let m = /^(\w+)\s+(.*)/.exec(body)
        let cmd = m ? m[1] : body
        let args = m ? m[2] : ""
        let rawArgs = args
        args = htmlQuote(args)
        cmd = htmlQuote(cmd)
        if (tp == "@") {
            if (cmd == "parent" || cmd == "short") {
                res[cmd] = args
                return ""
            } else if (cmd == "video") {                
                return `<div class="ui embed" 
                            data-url="https://www.microbit.co.uk/embed/${args}" 
                            data-placeholder="https://www.microbit.co.uk/${args}/thumb" 
                            data-icon="video play">
                        </div>`                                
            } else if (cmd == "section") {
                return `<!-- section ${args} -->`
            } else {
                return error(`Unknown command: @${cmd}`)
            }
        } else {
            if (!cmd) {
                let r = endBox
                endBox = ""
                return r
            }

            let box = td.lookup(boxes, cmd)
            if (box) {
                let parts = box.split("@BODY@")
                endBox = parts[1]
                return parts[0].replace("@ARGS@", args)
            } else {
                return error(`Unknown box: ~${cmd}`)
            }
        }

        return error("Unhandled: " + cmd);
    })

    let columns = ""
    html = html.replace(/<!-- COLUMN -->[^]*?<!-- ENDCOLUMN -->/g, f => {
        columns += f
        return "<!-- col -->"
    })
    
    html = `<div class="ui text container">${html}</div>\n`

    if (columns)
        html += `
            <div class="ui three column stackable grid text container">
                ${columns}
            </div>`

    res["body"] = html
    return res
}

export function injectHtml(template: string, vars: td.SMap<string>) {
    return td.replaceFn(template, /@(\w+)@/g, (elt1: string[]) => {
        let result1: string;
        let key = elt1[1];
        result1 = orEmpty(vars[key]);
        if (! /^(body)$/.test(key)) {
            result1 = htmlQuote(result1);
        }
        return result1;
    });
}


export async function formatAsync(templ: string, pubdata: JsonBuilder): Promise<string> {
    if (pubdata["time"] != null) {
        pubdata["timems"] = pubdata["time"] * 1000;
        pubdata["humantime"] = humanTime(new Date(pubdata["timems"]));
    }

    let targets = {}
    let bodies = {}
    templ = td.replaceFn(templ, /<!--\s*SECTION\s+(\S+)\s+(\S+)\s*-->([^]*?)<!--\s*END\s*-->/g, (elt: string[]) => {
        let result: string;
        let name = elt[1];
        targets[name] = elt[2];
        bodies[name] = elt[3];
        result = "";
        return result;
    });
    let body = (pubdata["body"] || "").replace(/<div class='md-para'>\s*<\/div>/g, "");
    let s = body.replace(/^\s*<div[^<>]*md-tutorial[^<>]*>/g, "");
    if (s != body) {
        body = s.replace(/<\/div>\s*$/g, "");
    }
    body = body.replace(/<div[^<>]md-tutorial[^<>]*>\s*<\/div>/g, "");
    let sects = body.split("<hr ");
    if (sects.length > 1 && sects[0].trim(" \t\n") == "") {
        sects.splice(0, 1);
    }
    else {
        let sname = "main";
        if (sects.length == 1) {
            sname = "full";
        }
        sects[0] = "data-name='" + sname + "' data-arguments='' />" + sects[0];
    }
    let sinks = {};
    for (let s2 of sects) {
        let coll = (/[^>]*data-name='([^'"<>]*)' data-arguments='([^'"<>]*)'[^>]*>([^]*)/.exec(s2) || []);
        let sectjs = {};
        let name1 = decodeURIComponent(coll[1]);
        for (let s3 of decodeURIComponent(coll[2]).split(";")) {
            let s4 = s3.trim();
            let coll2 = (/^([^=]*)=(.*)/.exec(s4) || []);
            if (coll2[1] == null) {
                sectjs[s4] = "true";
            }
            else {
                sectjs[coll2[1]] = coll2[2];
            }
        }
        sectjs["body"] = coll[3];
        await expandInfo(sectjs);
        let b = sectjs["isvolatile"];
        if (b != null && b) {
            pubdata["isvolatile"] = true;
        }
        for (let fn of Object.keys(pubdata)) {
            if (!sectjs.hasOwnProperty(fn)) {
                sectjs[fn] = td.clone(pubdata[fn]);
            }
        }
        let expanded = "";
        let target = "main";
        let sectTempl = bodies[name1];
        if (sectTempl == null) {
            expanded = "<div>section definition missing: " + htmlQuote(name1) + "</div>";
        }
        else {
            target = targets[name1];
            let promos = sectjs["promo"];
            if (promos != null) {
                let accum = "";
                for (let promo of promos) {
                    let jsb = promo["promo"];
                    if (jsb == null) {
                        continue;
                    }
                    let replRes = fmt(promo, "<li class='promo-item'>\n    <strong>@promo.name@</strong> by @promo.username@, \n    <span class='promo-description'>@promo.description@</span>\n</li>");
                    if (orEmpty(jsb["link"]) != "") {
                        replRes = fmt(promo, "<li class='promo-item'>\n    <a href=\"@promo.link@\">@promo.name@</a> by @promo.username@,\n    <span class='promo-description'>@promo.description@</span>\n</li>");
                    }
                    accum = accum + replRes;
                }
                sectjs["body"] = orEmpty(sectjs["body"] + accum);
            }
            expanded = td.replaceFn(sectTempl, /@(\w+)@/g, (elt1: string[]) => {
                let result1: string;
                let key = elt1[1];
                result1 = orEmpty(sectjs[key]);
                if (! /^(body)$/.test(key)) {
                    result1 = htmlQuote(result1);
                }
                return result1;
            });
        }
        sinks[target] = orEmpty(sinks[target]) + expanded;
    }
    td.jsonCopyFrom(pubdata, td.clone(sinks));
    let expanded1 = td.replaceFn(templ, /@(\w+)(:\w+)?@/g, (mtch: string[]) => {
        let val = orEmpty(pubdata[mtch[1]]);
        if (mtch[2] == ":hide") {
            if (val.trim()) return "";
            else return "display:none;"
        }
        return val;
    });
    return expanded1;
}

var orEmpty = td.orEmpty;

export function htmlQuote(s: string): string {
    s = td.replaceAll(s, "&", "&amp;")
    s = td.replaceAll(s, "<", "&lt;")
    s = td.replaceAll(s, ">", "&gt;")
    s = td.replaceAll(s, "\"", "&quot;")
    s = td.replaceAll(s, "\'", "&#39;")
    return s;
}

export function init(expandInfo_: td.Action1<JsonBuilder>): void {
    expandInfo = expandInfo_;
}

/**
 * {language:html:html}
 */
function fmt(promo: JsonBuilder, html: string): string {
    let replRes = td.replaceFn(html, /@([a-zA-Z0-9_\.]+)@/g, (elt: string[]) => {
        let result: string;
        let jsb = promo;
        for (let fldName of elt[1].split(".")) {
            if (jsb == null) {
                break;
            }
            jsb = jsb[fldName];
        }
        if (jsb == null) {
            result = "";
        }
        else {
            result = htmlQuote(orEmpty(td.toString(jsb)));
        }
        return result;
    });
    return replRes;
}

function twoDigit(p: number): string {
    let s2 = "00" + p;
    return s2.substr(s2.length - 2, 2);
}

export function humanTime(p: Date): string {
    return p.getFullYear() + "-" + twoDigit(p.getMonth() + 1) + "-" + twoDigit(p.getDate()) +
        " " + twoDigit(p.getHours()) + ":" + twoDigit(p.getMinutes());
}


