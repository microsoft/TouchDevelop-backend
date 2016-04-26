# SSL certificates for TDB

## Generating SSL certificates

Create file `td.config` like this:


```
[ req ]
x509_extensions = v3_req
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[ req_distinguished_name ]
countryName = US
stateOrProvinceName = Washington
localityName = Redmond
0.organizationName = Microsoft
organizationalUnitName = Microsoft Research
commonName = www.pxt.io

[ v3_req ]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment

subjectAltName = @alt_names

[ alt_names ]

DNS.1 = pxt.io
DNS.2 = *.pxt.io
DNS.3 = userpxt.io
DNS.3 = *.userpxt.io
...
```

Run:

```bash
openssl req -new -newkey rsa:2048 -nodes -sha256 -config td.config -days 730 -keyout td.key -out td.csr
```

Make sure you keep `td.key` secure. `td.csr` isn't confidential and will be
required by whoever generate the certificate.

Once you get the certificate, you need to create a password-less `.pfx` file,
which contains the key, your certificate, and all certificates between your
certificate and root (root is optional).  Without the upper level
certificates, the service will work in desktop Chrome and IE, but not in
Firefox, or on Android. 

For example, if you have a `mycert.p7b` file with all needed certificates, do the
following:

```
openssl pkcs7 -print_certs -in mycert.p7b -out cert.cer
openssl pkcs12 -export -in cert.cer -inkey td.key -out cert.pfx
node -p 'require("fs").readFileSync("cert.pfx").toString("base64")' > cert.pfx.b64
```

After first step you may want to remove the root certificate from `cert.cer`
if it's there. This will make the certificate slightly smaller. 

The contents of `cert.pfx.b64` is what you need to put int `TD_HTTPS_PFX`.
The `.pfx` file contains key and therefore needs to be kept secure.


