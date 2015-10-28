function describePlural(value, unit) {
    return value + " " + unit + (value == 1 ? "" : "s")
}
function describetime(now, other) {
    var seconds = now - other
    if (isNaN(seconds)) return ""
    var timeString
    if (seconds < 0)
        return "now"
    else if (seconds < 10)
        return "a few seconds ago"
    else if (seconds < 60)
        return " " + describePlural(Math.floor(seconds), "second") + " ago"
    else if (seconds < 2 * 60)
        return "a minute ago"
    else if (seconds < 60 * 60)
        return " " + describePlural(Math.floor(seconds / 60), "minute") + " ago"
    else if (seconds < 2 * 60 * 60)
        return "an hour ago";
    else if (seconds < 60 * 60 * 24)
        return " " + describePlural(Math.floor(seconds / 60 / 60), "hour") + " ago"
    else if (seconds < 60 * 60 * 24 * 30)
        return " " + describePlural(Math.floor(seconds / 60 / 60 / 24), "day") + " ago"
    else if (seconds < 60 * 60 * 24 * 365)
        return " " + describePlural(Math.floor(seconds / 60 / 60 / 24 / 30), "month") + " ago"
    else
        return " " + describePlural(Math.floor(seconds / 60 / 60 / 24 / 365), "year") + " ago"
}
function scriptlistitem(url, idmap, now, script) {
    var when = describetime(now, script.time)
    var icon = script.icon
    var iconbackground = script.iconbg
    var iconurl = script.iconurl
    var userscripturl = script.userscripturl
    var userid = script.userid
    var publicationscriptid = script.pubid
    var updateid = script.updateid
    var name = script.pubname
    var nickname = script.username
    var capabilities = script.capabilities
    var haserrors = script.haserrors
    var screenshotthumburl = script.screenshotthumburl
    var screenshoturl = script.screenshoturl
    var info = ""
    if (script.islibrary) info += " <span title='library - a reusable module of code and data' class='symbol'>♻</span>"
    if (script.positivereviews) info += " <span title='number of ♥ given by users'>" + script.positivereviews + " ♥</span>"
    if (script.comments) info += " <span title='number of discussions on this script started by users'>" + script.comments + " ✉</span>"
    var hidden = script.hidden || updateid && publicationscriptid != updateid

    if (idmap && !userscripturl) {
        if (idmap[publicationscriptid]) return ""
        idmap[publicationscriptid] = true
    }   

    var text = ""
    text += "<div style='height:112px;width:456px;position:relative;'>"
    {
        var style = ""
        if (hidden) style += 'opacity:0.5;filter:alpha(opacity=50);'
        var left = 88
        if (screenshotthumburl) left += 52

        text += "<div style='bottom:0px;left:" + left + "px;position:absolute;" + style + "'>"
        if (haserrors) {
            text += "<img alt='has errors' src='/iconslight/haserrors.png' width='36px' height='36px' />"
        } else {
            for (var i = 0; i < capabilities.length; i++) {
                var capability = capabilities[i]
                text += "<img alt='" + capability.sinkname + "' src='" + capability.iconurl + "' width='36px' height='36px' />"
            }
        }
        text += "</div>"
        text += "<div style='height:112px;width:" + left + "px;top:0px;left:0px;position:absolute;" + style + "'>"
        {
            text += "<div style='bottom:11px;right:" + (left - 80) + "px;font-size:12px;white-space:nowrap;position:absolute;'>" + (when != "never" ? when : "") + "</div>"
            if (userscripturl) {
                text += "<a href='" + userscripturl + "'>"
            } else if (publicationscriptid) {
                text += "<a href='" + url + publicationscriptid + "'>"
            }
            {
                text += "<img alt='" + icon + "' src='" + iconurl + "' style='background-color:" + iconbackground + ";padding:0;height:64px;width:64px;top:8px;left:8px;position:absolute;border:0;' />"
            }
            if (userscripturl || publicationscriptid) {
                text += "</a>"
            }
            if (screenshotthumburl) {
                text += "<a href='" + screenshoturl + "'><img alt='" + icon + "' src='" + screenshotthumburl + "' style='padding:0;height:64px;width:40px;top:8px;left:88px;position:absolute;border:0;' /></a>"
            }
        }
        text += "</div>"
        text += "<div style='width:" + (360 - left) + "px;left:" + left + "px;font-size:30px;white-space:nowrap;overflow:hidden;position:absolute;" + style + "'>"
        if (userscripturl) {
            text += "<a class='scriptName' href='" + userscripturl + "'>" + name + "</a>"
        } else if (publicationscriptid) {
            text += "<a class='scriptName' href='" + url + publicationscriptid + "'>" + name + "</a>"
        }
        text += "</div>"
        text += "<div style='top:52px;left:" + left + "px;font-size:18px;position:absolute;" + style + "'>"
        if (userscripturl) {
            text += "<input type='checkbox' name='uninstall' value='" + userscripturl + "'/> uninstall"
        } else {
            text += "<a href='" + url + userid + "' style='text-decoration: none'>" + nickname + "</a>"
        }
        text += "</div>"
        text += "<div style='bottom:8px;right:8px;font-size:24px;position:absolute;" + style + "'>" + info + "</div>"
        text += "<div style='bottom:42px;right:16px;position:absolute;" + style + "'></div>"
        text += "<div style='top:6px;right:8px;font-size:24px;position:absolute;" + style + "'>"
        if (publicationscriptid)
        {
            text += "<a href='" + url + publicationscriptid + "' style='text-decoration: none;'>/" + publicationscriptid + "</a>"
        }
        text += "</div>"

        if (updateid && publicationscriptid != updateid) {
            text += "<div style='top: 52px; right: 8px; font-size: 18px; position: absolute;'>updated by /<a href='/" + updateid + "'>" + updateid + "</a></div>"
        } else if (hidden) {
            text += "<div style='top: 52px; right: 8px; font-size: 18px; position: absolute;'>hidden</div>"
        }
    }
    text += "</div>"
    text += "<div class='clear'></div>"
    return text
}
function reviewlistitem(now, review) {
    var when = describetime(now, review.time)
    var userurl = review.userurl
    var publicationurl = review.puburl
    var publicationid = review.pubid
    var publicationname = review.pubname
    var nickname = review.nickname
    var info = review.stars >= 3 ? "♥" : ""
    var reviewtext = review.text

    var text = ""
    text += "<div style='height: 112px; width: 456px; position: relative;'>"
    {
        text += "<div style='height: 112px; width: 88px; top: 0px; left: 0px; position: absolute;'>"
        {
            text += "<div style='font-size: 48px; position: absolute; top: 24px; left: 24px; '>" + info + "</div>"
        }
        text += "</div>"

        text += "<div style='width: 368px; left: 88px; overflow: hidden; position: absolute;'>"
        {
            text += "<div style='width: 368px; left: 0px; font-size: 30px; white-space: nowrap; overflow: hidden;'>"
            text += "<a class='scriptName' href='" + publicationurl + "'>" + publicationname + "</a>"
            text += "</div>"
            text += "<div style='width: 368px; left: 0px; font-size: 15px; white-space: nowrap; overflow: hidden;'>"
            text += "by<br/>"
            text += "<a class='scriptName' href='" + userurl + "'>" + nickname + "</a>"
            text += "</div>"
            text += "<span style='font-size: 12px; white-space: nowrap;'>" + (when != "never" ? when : "") + "</span>"
        }
        text += "</div>"
    }
    text += "</div>"
    text += "<div class='clear'></div>"
    return text
}
function commentlistitem(now, comment) {
    var when = describetime(now, comment.time)
    var userurl = comment.userurl
    var commenturl = comment.commenturl
    var publicationurl = comment.puburl
    var publicationid = comment.pubid
    var publicationname = comment.pubname
    var nickname = comment.nickname
    var commenttext = comment.text
    var location = comment.location
    
    var text = ""
    text += "<div style='height: 112px; width: 456px; position: relative;'>"
    {
        text += "<div style='height: 80px; width: 456px; top: 0px; left: 0px; overflow: hidden; position: absolute;'>"
        {
            text += "<div style='width: 456px; left: 0px; font-size: 30px; white-space: nowrap; overflow: hidden;'>"
            text += "<a class='scriptName' href='" + publicationurl + "'>" + publicationname + "</a>"
            text += "</div>"
            text += "<div style='width: 456px; left: 0px; font-size: 15px; white-space: nowrap; overflow: hidden;'>"
            text += "commented by <a class='scriptName' href='" + userurl + "'>" + nickname + "</a><br/>"
            text += "<a href='" + commenturl + "'>" + commenttext + "</a>"
            text += "</div>"
        }
        text += "</div>"
        text += "<div style='width: 456px; bottom: 11px; font-size: 12px; white-space: nowrap; overflow: hidden; position: absolute;'>" + (when != "never" ? when : "") + "</div>"
        text += "<div style='bottom: 8px; right: 8px; font-size: 24px; position: absolute;'>" + location + "</div>"
    }
    text += "</div>"
    text += "<div class='clear'></div>"
    return text
}
function featurelistitem(now, feature) {
    var featureurl = feature.url
    var featuretitle = feature.title
    var featuretext = feature.text

    var text = ""
    text += "<div style='height: 64px; width: 456px; position: relative;'>"
    {
        text += "<div style='height: 64px; width: 88px; top: 0px; left: 0px; position: absolute;'>"
        {
            text += "<div style='font-size: 48px; position: absolute; top: 0px; left: 24px; '>&#9874;</div>"
        }
        text += "</div>"

        text += "<div style='height: 64px; left: 88px; width: 368px; top: 0px; overflow: hidden; position: absolute;'>"
        {
            text += "<div style='width: 368px; left: 0px; font-size: 30px; white-space: nowrap; overflow: hidden;'>"
            if (featureurl)
                text += "<a class='scriptName' href='" + featureurl + "'>" + featuretitle + "</a>"
            else
                text += featuretitle
            text += "</div>"
            text += "<div style='width: 368px; left: 0px; font-size: 15px; white-space: nowrap; overflow: hidden;'>"
            text += featuretext
            text += "</div>"
        }
        text += "</div>"
    }
    text += "</div>"
    text += "<div class='clear'></div>"
    return text
}
function documentlistitem(now, document) {
    var documenturl = document.url
    var documentname = document.name
    var documentmimetype = document.mimetype
    var documentabstract = document.abstract
    var documentviews = document.views

    var info = ""
    if (documentmimetype == "") info = "web";
    if (documentmimetype == "application/pdf") info = "PDF";
    else if (documentmimetype == "application/vnd.openxmlformats-officedocument.presentationml.presentation") info = "slides";
    else if (documentmimetype == "video/mp4") info = "video";

    var text = ""
    text += "<div style='height: 64px; width: 456px; position: relative;'>"
    {
        text += "<div style='height: 64px; width: 88px; top: 0px; left: 0px; position: absolute;'>"
        {
            text += "<div style='font-size: 30px; white-space: nowrap; overflow: hidden; '>" + info + "</div>"
            if (documentviews > 1) 
            {
                if (documentviews >= 1000000) documentviews = Math.floor(documentviews / 1000000) + "M"
                else if (documentviews >= 1000) documentviews = Math.floor(documentviews / 1000) + "K"
                text += "<div style='width: 368px; left: 0px; font-size: 15px; white-space: nowrap; overflow: hidden;'>" + documentviews + " views</div>"
            }
        }
        text += "</div>"

        text += "<div style='height: 64px; width: 368px; top: 0px; left: 88px; overflow: hidden; position: absolute;'>"
        {
            text += "<div style='width: 368px; left: 0px; font-size: 30px; white-space: nowrap; overflow: hidden;'>"
            text += "<a class='scriptName' href='" + documenturl + "'>" + documentname + "</a>"
            text += "</div>"
            text += "<div style='width: 368px; left: 0px; font-size: 15px; white-space: nowrap; overflow: hidden;'>" + documentabstract + "</div>"
        }
        text += "</div>"
    }
    text += "</div>"
    text += "<div class='clear'></div>"
    return text
}
function userlistitem(now, user) {
    var userurl = user.url
    var userid = user.id
    var usernickname = user.nickname
    var userabout = user.aboutme
    var square50url = user.square50url
    if (!square50url) square50url = "/iconslight/userlarge.png";
    var info = ""
    if (user.receivedpositivereviews) info += " <span title='number of ♥ given by other users'>" + user.receivedpositivereviews + " ♥</span>"
    if (user.subscribers) info += " <span title='number of users subscribed to this user'>" + user.subscribers + " ♟</span>"
    if (user.features) info += " <span title='number language features used'>" + user.features + " <span class='symbol'>⚒</span></span>"
    var text = ""
    text += "<div style='height: 100px; width: 456px; position: relative;'>"
    {
        text += "<div style='height: 100px; width: 88px; top: 0px; left: 0px; overflow: hidden; position: absolute;'>"
        {
            if (square50url)
                text += "<a href='" + userurl + "'><img alt='profile picture' src='" + square50url + "' style='padding:0;width:50px;height:50px;top:10px;left:8px;position:absolute;border:0;' /></a>"
        }
        text += "</div>"
        text += "<div style='width: 368px; left: 88px; top: 0px; font-size: 30px; white-space: nowrap; overflow: hidden; position: absolute;'>"
        text += "<a class='scriptName' href='" + userurl + "'>" + usernickname + "</a>"
        text += "</div>"
        text += "<div style='width: 368px; left: 88px; top: 40px; font-size: 15px; white-space: nowrap; overflow: hidden; position: absolute;'>"
        text += userabout
        text += "</div>"
        if (user.score)
            text += "<div style='bottom:8px;left:88px;font-size:24px;position:absolute;'><span style='font-weight:bold;' title='overall user score'>" + user.score + "</span></div>"
        text += "<div style='bottom:8px;right:8px;font-size:24px;position:absolute;'>" + info + "</div>"
    }
    text += "</div>"
    text += "<div class='clear'></div>"
    return text
}
function screenshotlistitem(now, screenshot) {
    var when = describetime(now, screenshot.time)
    var publicationurl = screenshot.puburl
    var publicationid = screenshot.pubid
    var publicationname = screenshot.pubname
    var userurl = screenshot.userurl
    var thumburl = screenshot.thumburl
    var url = screenshot.url
    var nickname = screenshot.nickname

    var text = ""
    text += "<div style='height: 112px; width: 456px; position: relative;'>"
    {
        text += "<div style='height: 112px; width: 88px; top: 0px; left: 0px; overflow: hidden; position: absolute;'>"
        {
            text += "<a href='" + url + "'><img alt='screenshot' src='" + thumburl + "' style='padding: 0; height: 107px; top: 0px; left: 8px; position: absolute; border: 0;' /></a>"
        }
        text += "</div>"
        text += "<div style='width: 368px; left: 88px; top: 0px; font-size: 30px; white-space: nowrap; overflow: hidden; position: absolute;'>"
        text += "<a class='scriptName' href='" + publicationurl + "'>" + publicationname + "</a>"
        text += "</div>"
        text += "<div style='width: 368px; left: 88px; top: 40px; font-size: 15px; white-space: nowrap; overflow: hidden; position: absolute;'>"
        text += "screenshot by <br/><a class='scriptName' href='" + userurl + "'>" + nickname + "</a>"
        text += "</div>"
        text += "<div style='width: 368px; left: 88px; bottom: 11px; font-size: 12px; white-space: nowrap; overflow: hidden; position: absolute;'>"
        text += (when != "never" ? when : "")
        text += "</div>"
    }
    text += "</div>"
    text += "<div class='clear'></div>"
    return text
}
function artlistitem(now, art) {
    var when = describetime(now, art.time)
    var userurl = art.userurl
    var thumburl = art.thumburl
    var backgroundcss = "background-image:url(https://www.touchdevelop.com/Images/artbackground.png);background-repeat:repeat;"
    var arttitle
    if (thumburl) {
        arttitle = "art picture"
    }
    else {
        thumburl = "/Images/play.png"
        backgroundcss = ""
        arttitle = "art sound"
    }
    var url = art.url
    var nickname = art.nickname

    var text = ""
    text += "<div style='height: 112px; width: 456px; position: relative;'>"
    {
        text += "<div style='height: 112px; width: 133px; top: 0px; left: 0px; overflow: hidden; position: absolute;'>"
        {
            text += "<a style='display:block;width:112px;height:112px;top:0px;left:8px;position:absolute;" + backgroundcss + "display:table-cell;vertical-align:middle;' href='" + url + "'><img alt='art' src='" + thumburl + "' style='margin:auto;max-width:100%;max-height:100%;padding:0;border:0;' /></a>"
        }
        text += "</div>"
        text += "<div style='width: 325px; left: 133px; top: 0px; font-size: 30px; white-space: nowrap; overflow: hidden; position: absolute;'>"
        text += "<a class='scriptName' href='" + url + "'>" + art.name + "</a>"
        text += "</div>"
        text += "<div style='width: 325px; left: 133px; top: 40px; font-size: 15px; white-space: nowrap; overflow: hidden; position: absolute;'>"
        text += arttitle + " by <br/><a class='scriptName' href='" + userurl + "'>" + nickname + "</a>"
        text += "</div>"
        text += "<div style='width: 325px; left: 133px; bottom: 11px; font-size: 12px; white-space: nowrap; overflow: hidden; position: absolute;'>"
        text += (when != "never" ? when : "")
        text += "</div>"
    }
    text += "</div>"
    text += "<div class='clear'></div>"
    return text
}
function scorelistitem(now, score) {
    var when = describetime(now, score.time)
    var userurl = score.userurl
    var publicationurl = score.puburl
    var publicationid = score.pubid
    var publicationname = score.pubname
    var nickname = score.nickname
    var scorevalue = score.score

    var text = ""
    text += "<div style='height: 112px; width: 456px; position: relative;'>"
    {
        text += "<div style='height: 112px; width: 88px; top: 0px; left: 0px; position: absolute;'>"
        {
            text += "<div style='font-size: 48px; position: absolute; top: 8px; left: 8px; '>" + scorevalue + "</div>"
        }
        text += "</div>"

        text += "<div style='width: 368px; left: 88px; overflow: hidden; position: absolute;'>"
        {
            text += "<div style='width: 368px; left: 0px; font-size: 30px; white-space: nowrap; overflow: hidden;'>"
            text += "<a class='scriptName' href='" + publicationurl + "'>" + publicationname + "</a>"
            text += "</div>"
            text += "<div style='width: 368px; left: 0px; font-size: 15px; white-space: nowrap; overflow: hidden;'>"
            text += "scored by<br/>"
            text += "<a class='scriptName' href='" + userurl + "'>" + nickname + "</a>"
            text += "</div>"
            text += "<span style='font-size: 12px; white-space: nowrap;'>" + (when != "never" ? when : "") + "</span>"
        }
        text += "</div>"
    }
    text += "</div>"
    text += "<div class='clear'></div>"
    return text
}
function taglistitem(now, tag) {
    var when = describetime(now, tag.time)
    var publicationurl = tag.puburl
    var publicationid = tag.pubid
    var publicationname = tag.pubname
    var instances = tag.instances

    var text = ""
    text += "<div style='height: 112px; width: 456px; position: relative;'>"
    {
        text += "<div style='height: 112px; width: 88px; top: 0px; left: 0px; position: absolute;'>"
        {
            text += "<div style='font-size: 30px; position: absolute; top: 8px; left: 8px; '>x " + instances + "</div>"
        }
        text += "</div>"

        text += "<div style='width: 368px; left: 88px; overflow: hidden; position: absolute;'>"
        {
            text += "<div style='width: 368px; left: 0px; font-size: 30px; white-space: nowrap; overflow: hidden;'>"
            text += "<a class='scriptName' href='" + publicationurl + "'>" + publicationname + "</a>"
            text += "</div>"
            text += "<div style='width: 368px; left: 0px; font-size: 15px; white-space: nowrap; overflow: hidden;'>"
            text += "tag"
            text += "</div>"
            text += "<span style='font-size: 12px; white-space: nowrap;'>" + (when != "never" ? when : "") + "</span>"
        }
        text += "</div>"
    }
    text += "</div>"
    text += "<div class='clear'></div>"
    return text
}
var idmaps = new Object()
function itemlist(url, now, what, create, items) {
    if (!now) now = Math.floor(new Date().getTime() / 1000)
    var text = ""
    if (create) text += "<div id='list:" + what + "'>"
    var idmap = idmaps[what]
    if (!idmap) idmaps[what] = idmap = new Object()
    for (var i = 0; i < items.length; i++) {
        var item = items[i]
        var kind = item.kind
        if (kind == "script") text += scriptlistitem(url, idmap, now, item)
        else if (kind == "comment") text += commentlistitem(now, item)
        else if (kind == "feature") text += featurelistitem(now, item)
        else if (kind == "document") text += documentlistitem(now, item)
        else if (kind == "user") text += userlistitem(now, item)
        else if (kind == "review") text += reviewlistitem(now, item)
        else if (kind == "leaderboardscore") text += scorelistitem(now, item)
        else if (kind == "screenshot") text += screenshotlistitem(now, item)
        else if (kind == "tag") text += taglistitem(now, item)
        else if (kind == "art") text += artlistitem(now, item)
    }
    if (create) text += "</div>"
    return text;
}
function getmorelinkinner(what, continuation, text, publicationid, userid) {
    var action = 'getmore("' + what + '","' + continuation + '","' + encodeURI(text) + '","' + encodeURI(publicationid) + '","' + encodeURI(userid) + '")'
    return "<a class='paging-more-link' href='javascript:" + action + "'>show more</a>"
}
function getmore(what, continuation, text, publicationid, userid) {
    var linkDiv = document.getElementById("link:" + what)
    var listDiv = document.getElementById("list:" + what)
    linkDiv.innerHTML = "loading..."
    var query = "/query/scripts/" + what + "?applyupdates=true"
    if (continuation) query += "&continuation=" + continuation
    if (text) query += "&text=" + text
    if (publicationid) query += "&scriptid=" + publicationid
    if (userid) query += "&userid=" + userid
    var queryClient;
    function querySuccess() {
        var data = JSON.parse(queryClient.responseText);
        var newContainerDiv = document.createElement("div")
        listDiv.appendChild(newContainerDiv)
        newContainerDiv.innerHTML = itemlist(data.url, 0, what, false, data.items)
        linkDiv.innerHTML = data.continuation ? getmorelinkinner(what, data.continuation, text, publicationid, userid) : ""
    }
    function queryError() {
        linkDiv.innerHTML = "error"
    }
    function ready() {
        if (queryClient.readyState == 4)
            if (queryClient.status == 200)
                querySuccess();
            else
                queryError();
    }
    queryClient = new XMLHttpRequest()
    queryClient.onreadystatechange = ready
    queryClient.open("GET", query)
    queryClient.send()
}
function getmorelink(what, continuation, text, publicationid, userid) {
    return "<div class='paging-more-link' id='link:" + what + "'>" + getmorelinkinner(what, continuation, text, publicationid, userid) + "</div>"
}
function moveCaretToEnd(element) {
    element.focus();
    if (typeof element.selectionStart == "number") {
        element.selectionStart = element.selectionEnd = element.value.length;
    } else if (typeof element.createTextRange != "undefined") {
        var range = element.createTextRange();
        range.collapse(false);
        range.select();
    }
}
var defaultHash
function getPivotDisplay(id, targetid) {
    if (id.length > 6 && id.substr(0, 6) == "pivot:")
        return id == targetid ? "block" : "none"
}
function selectPivot(newHash) {
    if (!defaultHash) return
    var oldHash = window.location.hash
    var targetid = "pivot:" + newHash.substr(1)
    var elements = document.getElementsByTagName("div")
    for (var i = 0; i < elements.length; i++) {
        var display = getPivotDisplay(elements[i].id, targetid)
        if (typeof display == "string")
            elements[i].style.display = display
    }
    if (oldHash != newHash &&
        (window.location.hash || newHash != defaultHash))
        window.location.replace(window.location.href.split("#")[0] + newHash)
}
function getCurrentHash() {
    var hash = window.location.hash
    return hash ? hash : defaultHash
}
function hashChanged() {
    if (!defaultHash) return
    selectPivot(getCurrentHash())
}
function loaded() {
    if (!defaultHash) return
    selectPivot(getCurrentHash())
}
function visible(element) {
    if (element.offsetWidth === 0 || element.offsetHeight === 0) return false
    var height = document.documentElement.clientHeight
    var rects = element.getClientRects()
    for (var i = 0, l = rects.length; i < l; i++) {
        var r = rects[i]
        if (r.top > 0 ? r.top <= height : (r.bottom > 0 && r.bottom <= height))
            return true
    }
    return false;
}
function autoGetMore() {
    var elements = document.getElementsByTagName("a")
    for (var i = 0; i < elements.length; i++) {
        var element = elements[i]
        if (element.getAttribute("class") == "paging-more-link" &&
                    visible(element))
            eval(element.href.substr("javascript:".length))
    }
}
function showCloud() {
    var elements = document.querySelectorAll(".hiddencloud")
    for (var i = 0; i < elements.length; i++)
        elements[i].setAttribute("class", "visiblecloud")
    document.getElementById("showCloud").style.display = "none";
    document.getElementById("hideCloud").style.display = "";
}
function hideCloud() {
    var elements = document.querySelectorAll(".visiblecloud")
    for (var i = 0; i < elements.length; i++)
        elements[i].setAttribute("class", "hiddencloud")
    document.getElementById("hideCloud").style.display = "none";
    document.getElementById("showCloud").style.display = "";
}
var initBannerDone = false;
function initBanner() {
    if (initBannerDone) return;
    initBannerDone = true;
    var msg
    if (window.openUrl == "#") msg = "";
    else if (window.openUrl) msg = "open script in app";
    else msg = "open web app";
    var e = document.getElementById("menulink");
    if (e) {
        if (msg) e.innerText = msg;
        if (window.openUrl) e.href = window.openUrl;
    }
}
function initPage() {
    function setSizes() {
        var r = document.getElementById("root");
        if (!r) return;
        var c = "root";
        if (window.innerWidth < 900) c += " phone";
        r.className = c;
    }
    setSizes();
    window.addEventListener('load', setSizes, false);
    window.addEventListener('resize', setSizes, false);
}