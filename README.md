# TouchDevelop backend

Back-end cloud service for [Touch Develop] (https://github.com/Microsoft/TouchDevelop)

## Setup

In order to build Touch Develop backend, ensure that you have
[Git](http://git-scm.com/downloads) and [Node.js](http://nodejs.org/)
installed. 

[Visual Studio Code] (https://code.visualstudio.com/), a free cross-platform
IDE, is useful for editing (but not required). Settings files are checked in.

Clone a copy of the repo:

```
git clone https://github.com/Microsoft/TouchDevelop-backend.git
```

```
cd TouchDevelop-backend
npm install tsd@next -g
tsd reinstall
npm install
make
```

## Web stuff

First install Ruby 2.2+. Then:


```
cd web
gem install bundler
bundler install
bundle exec jekyll serve
```

## LICENSE

The MIT License (MIT)

Copyright (c) 2015 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
