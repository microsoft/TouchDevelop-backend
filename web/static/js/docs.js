var topicOriginal = ''
var topicTranslated = ''

function isIE() {
    return /trident/i.test(navigator.userAgent);
}

function dirAuto($el) {
    if ($el) {
        if (!isIE())
            $el.attr('dir', 'auto');
        else {
            var dir = /^[\s\.;:(+0-9]*[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/i.test($el.text()) ? "rtl" : "ltr";
            $el.attr('dir', dir);
        }
    }
    return $el;
}

function azureSearchSource(query, cb) {
    $.ajax({
        url: "https://www.touchdevelop.com/api/pointers?q=feature:@ptr-docs+" + encodeURIComponent(query),        
        success: function (results) {
            cb(results.items);
        }
    });
}

function loadTranslatedDocs(lang) {
    $.getJSON('https://tdtutorialtranslator.blob.core.windows.net/docs/' + lang + '/' + topicId, function (res) {
        topicTranslated = res.body.join('\n');
        if (!res.manual) topicTranslated += '<div dir="ltr" class="bg-info">Translations by Microsoft® Translator</div>';
        dirAuto($('#contentBody').html(topicTranslated));
    })
        .fail(function (e) {
            $.getJSON('https://tdtutorialtranslator.azurewebsites.net/api/translate_doc?scriptId=' + topicId + '&to=' + lang, function (res2) {
                topicTranslated = res2.info.body.join('\n');
                if (!res2.info.manual) topicTranslated += '<div dir="ltr" class="bg-info">Translations by Microsoft® Translator</div>';
                dirAuto($('#contentBody').html(topicTranslated));
            })
        });
}

function docTranslate() {
    var lang = window.navigator.language || window.navigator.userLanguage || "en"
    var m = /lang=([a-zA-Z\-]+)/.exec(window.location.href)
    if (m) { lang = m[1]; }
    lang = lang.slice(0, 2)
    if (lang == "zh") lang = "zh-CHS"
    if (!lang || /^en/i.test(lang)) {
        $('#translateBtnGroup').hide();
    } else {
        $('#translateBtnGroup').show();
        var translated = false;
        var original = "";
        $('#translateBtn').click(function (e) {
            e.preventDefault();
            if (translated) {
                dirAuto($('#contentBody').html(original));
            }
            else {
                if (!original) original = $('#contentBody').html();
                if (topicTranslated) dirAuto($('#contentBody').html(topicTranslated));
                else loadTranslatedDocs(lang);
            }
            translated = !translated;
        });
    }
}

$(document).ready(function () {
    docTranslate();
    $('#searchInput').typeahead({
        minLength: 2,
        highlight: false,
        hint: true,
    },
        {
            name: 'docsearch',
            source: azureSearchSource,
            templates: {
                suggestion: function (item) {
                    var a = document.createElement('a');
                    a.href = '/' + item.path;
                    a.innerText = item.scriptname;
                    return a;
                }
            }
        });
    loadSocialButtons();
});

$(document).ready(function () {
    $('.md-video-link').on("click", function () {
        var name = $(this).data("playerurl") || $(this).data("videosrc");
        $(this).find("img").remove();
        $(this).find("svg").remove();
        var outer = $('<div />', {
            "class": 'embed-responsive embed-responsive-16by9'
        });
        outer.appendTo($(this));
        $('<iframe>', {
            class: 'embed-responsive-item',
            src: name,
            frameborder: 0,
            scrolling: 'no'
        }).appendTo(outer);
    });
});
