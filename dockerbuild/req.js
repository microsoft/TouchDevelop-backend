var request = require("request")

var k = 0
for (var i = 0; i < 100; i++)
request({url:"http://localhost:1337/compile", json:true, 
method: "post",
body: {maincpp:"#include \"MicroBitTouchDevelop.h\"\nvoid app_main(){}"}
}, function(err, resp, body) {
      console.log(k++, JSON.stringify(resp.body).length)
})
