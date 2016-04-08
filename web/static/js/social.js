function loadSocialButtons() {
    var d = document.getElementById('like')
    if (d != null) {
        var text = d.title;
        var url = d.getAttribute('href', 0);
        if (url == null) url = location.href;
        d.innerHTML = d.innerHTML
          + "<iframe src='//www.facebook.com/plugins/like.php?href=" + encodeURI(url) + "&amp;layout=button_count&amp;show_faces=false&amp;width=100&amp;action=like&amp;font=segoe+ui&amp;colorscheme=light&amp;height=21' scrolling='no' frameborder='0' style='border:none;overflow:hidden;width:80px;height:21px;' allowTransparency='true'></iframe>";
    }
    
    d = document.getElementById('tweet')
    if (d != null) {
        var text = d.title;
        var url = d.getAttribute('href', 0);
        if (url == null) url = location.href;
        d.innerHTML = d.innerHTML
          + "<iframe src='//platform.twitter.com/widgets/tweet_button.html?url=" + encodeURI(url) + "&amp;text=" + encodeURI(text) + "&amp;count=horizontal'style='border:none;overflow:hidden;width:56px;height:21px;' frameBorder=0 scrolling=no></iframe>";
    }
}
loadSocialButtons();
