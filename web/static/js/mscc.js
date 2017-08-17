$(document).ready(function () {
    var url = "https://uhf.microsoft.com/" + navigator.language + "/shell/api/mscc?sitename=touchdevelopweb&domain=touchdevelop.com&mscc_eudomain=true";
    $.getJSON(url, function (info) {
        try {
            if (!info || !info.IsConsentRequired) return undefined;

            info.Css.forEach(css => {
                var link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = css;
                document.head.appendChild(link);
            })

            var d = $('<div class="mscc"></div>');
            d.html(info.Markup);
            $(document.body).append(d);
            info.Js.forEach(function (js) { $.getScript(js) });
        } catch (e) {
            console.error(e);
        }
    });
});
