var maxImageWidth = 240;
var maxImageHeight = 40;
var progress = mkProgressBar();

function loadExternalAssets() {
	var span = document.getElementById("screenshots");
	if (span && !span.loaded) {
		span.innerHTML = "<a href='https://www.touchdevelop.com/aaloi'><img class='screenshot img-thumbnail' title='Gravity' alt='Gravity' src='https://az31353.vo.msecnd.net/thumb/gxumcnmi'/></a><a href='https://www.touchdevelop.com/kxvnc'><img class='screenshot img-thumbnail' title='paratoilet' alt='paratoilet' src='https://az31353.vo.msecnd.net/thumb/eeuxmmbw'/></a><a href='https://www.touchdevelop.com/wgrzc'><img class='screenshot img-thumbnail' title='incredible love' alt='incredible love' src='https://az31353.vo.msecnd.net/thumb/mkmzohtt'/></a><a href='https://www.touchdevelop.com/uzsc'><img class='screenshot img-thumbnail' title='your shake of the day' alt='your shake of the day' src='https://az31353.vo.msecnd.net/thumb/girngmjk'/></a><a href='https://www.touchdevelop.com/cjrfa'><img class='screenshot img-thumbnail' title='BlockY World' alt='BlockY World' src='https://az31353.vo.msecnd.net/thumb/gsutchic'/></a><a href='https://www.touchdevelop.com/avvrd'><img class='screenshot img-thumbnail' title='DataFit' alt='DataFit' src='https://az31353.vo.msecnd.net/thumb/bueeafku'/></a><a href='https://www.touchdevelop.com/srzl'><img class='screenshot img-thumbnail' title='pecman 2' alt='pecman 2' src='https://az31353.vo.msecnd.net/thumb/ybtgsept'/></a><a href='https://www.touchdevelop.com/owaoa'><img class='screenshot img-thumbnail' title='red nose splat' alt='red nose splat' src='https://az31353.vo.msecnd.net/thumb/aignyhax'/></a><a href='https://www.touchdevelop.com/eziu'><img class='screenshot img-thumbnail' title='Color Line' alt='Color Line' src='https://az31353.vo.msecnd.net/thumb/bvykmgph'/></a><a href='https://www.touchdevelop.com/agmkb'><img class='screenshot img-thumbnail' title='Fruit??ninja' alt='Fruit??ninja' src='https://az31353.vo.msecnd.net/thumb/jmmkawys'/></a><a href='https://www.touchdevelop.com/euhxe'><img class='screenshot img-thumbnail' title='exclusive game' alt='exclusive game' src='https://az31353.vo.msecnd.net/thumb/yqghihkm'/></a><a href='https://www.touchdevelop.com/szbwa'><img class='screenshot img-thumbnail' title='chop it, eh (Timberman)' alt='chop it, eh (Timberman)' src='https://az31353.vo.msecnd.net/thumb/lqnuyhqp'/></a><a href='https://www.touchdevelop.com/gtrbc'><img class='screenshot img-thumbnail' title='Globe' alt='Globe' src='https://az31353.vo.msecnd.net/thumb/oxpvczhq'/></a><a href='https://www.touchdevelop.com/ucpb'><img class='screenshot img-thumbnail' title='ReflexC&lt;&gt;reCoding™' alt='ReflexC&lt;&gt;reCoding™' src='https://az31353.vo.msecnd.net/thumb/srjnmtcj'/></a><a href='https://www.touchdevelop.com/yigdg'><img class='screenshot img-thumbnail' title='don&#39;t tap the white tile (piano tiles)' alt='don&#39;t tap the white tile (piano tiles)' src='https://az31353.vo.msecnd.net/thumb/edhzufep'/></a><a href='https://www.touchdevelop.com/xdgjc'><img class='screenshot img-thumbnail' title='Five nights at freddys 2' alt='Five nights at freddys 2' src='https://az31353.vo.msecnd.net/thumb/mtqsolpl'/></a><a href='https://www.touchdevelop.com/mgexa'><img class='screenshot img-thumbnail' title='binary game' alt='binary game' src='https://az31353.vo.msecnd.net/thumb/udcngnfi'/></a><a href='https://www.touchdevelop.com/setxe'><img class='screenshot img-thumbnail' title='fabulous bird' alt='fabulous bird' src='https://az31353.vo.msecnd.net/thumb/elfzyjof'/></a><a href='https://www.touchdevelop.com/tvrt'><img class='screenshot img-thumbnail' title='peacefull fishing' alt='peacefull fishing' src='https://az31353.vo.msecnd.net/thumb/smshldxe'/></a><a href='https://www.touchdevelop.com/yniba'><img class='screenshot img-thumbnail' title='Next Yesterday Radio App' alt='Next Yesterday Radio App' src='https://az31353.vo.msecnd.net/thumb/kjurofpg'/></a><a href='https://www.touchdevelop.com/ghzxa'><img class='screenshot img-thumbnail' title='World of Mario' alt='World of Mario' src='https://az31353.vo.msecnd.net/thumb/idkowrhi'/></a>";
		span.loaded = true;
	}
}

function div(cl, children) {
	var elt = document.createElement("div");
	if (cl != null)
		elt.className = cl;
	if (children)
		for (var i in children)
			if (children[i]) elt.appendChild(children[i]);
	return elt;
}
function mkProgressBar() {
	var a = [];
	for (var i = 0; i < 4; i++)
		a.push(div("progressDot progressDot-" + i));
	var r = div("progressBar", a);
	var n = 0;
	function update(k) {
		n += k;
		if (n < 0) n = 0;
		r.style.display = n > 0 ? "block" : "none";
	}
	update(0);

	r.start = function () { update(+1) };
	r.stop = function () { update(-1) };
	r.reset = function () { update(-n) };

	return r;
}

(function () {
	function ready() {
		if (client.readyState == 4 && client.status == 200) {
			var j = JSON.parse(client.responseText);
			var s = j.scripts + " scripts published";
			//if (j.windowsstoreapps > 0) s += "<br/>" + j.windowsstoreapps + " apps exported to Windows Store";
			//if (j.windowsphonestoreapps > 0) s += "<br/>" + j.windowsphonestoreapps + " apps exported to Windows Phone Store";
			document.getElementById("stats").innerHTML = s;
			loadExternalAssets();
		}
	}
	if (window.navigator.onLine) {
		var client = new XMLHttpRequest();
		client.onreadystatechange = ready;
		client.open("GET", "/api/stats");
		client.send();
		document.getElementById("screenshots").appendChild(progress);
		progress.start();
		setTimeout(function () {
			setTimeout(function () { if (progress) progress.stop(); progress = null; }, 40000);
		}, 20000);
	}
} ());
