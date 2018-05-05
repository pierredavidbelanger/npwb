# No Pain Web Builder

An easy as pie but very opinionated static web bundler.

## Install

```sh
$ npm install --save-dev npwb
```

## Use

Suppose you have a project structure like this:

```sh
$ tree -I node_modules
.
├── package-lock.json
├── package.json
└── src
    ├── index.html
    ├── index.js
    ├── index.scss
    └── logo.svg
```

`index.js` contains ES6 code that `require()` things from `node_modules`, 
in fact, this can contains anythings `browserify` and `babelify` can compile :)

`index.scss` contains standard SASS style instructions.

### For dev time: build, watch and serve

You want to use this line to build and watch (then re-build on change) without minification:

```sh
$ npx npwb --clean --indir src --outdir dist \
    --html *.html \
    --js *.js \
    --sass *.scss \
    --raw *.svg \
    --watch --serve --verbose
[serve] serving: /Users/me/myproject/dist -> localhost:8080
[ html] copied: /Users/me/myproject/src/index.html -> /Users/me/myproject/dist/index.html
[  raw] copied: /Users/me/myproject/src/logo.svg -> /Users/me/myproject/dist/logo.svg
[ sass] rendered: /Users/me/myproject/src/index.scss -> /Users/me/myproject/dist/index.css
[   js] compiled: /Users/me/myproject/src/index.js -> /Users/me/myproject/dist/index.js
```

### Build for production

You want to use this line to build only, with minification, ready for production:

```sh
$ npx npwb --clean --indir src --outdir dist \
    --html *.html \
    --js *.js \
    --sass *.scss \
    --raw *.svg \
    --minify
```

This will produce:

```sh
$ tree dist
dist
├── index.css
├── index.html
├── index.js
└── logo.svg
```
