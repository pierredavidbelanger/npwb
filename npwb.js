#!/usr/bin/env node

const minimist = require('minimist');

const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');

const argv = minimist(process.argv.slice(2));

if (!argv.indir) {
    console.error('[     ] --indir is mandatory');
    process.exit(-1);
}
if (!argv.outdir) {
    console.error('[     ] --outdir is mandatory');
    process.exit(-1);
}

const indir = path.resolve(argv.indir);
const outdir = path.resolve(argv.outdir);

if (argv.clean) {
    const del = require('del');
    del.sync(outdir);
}

mkdirp.sync(outdir);

const copyWithCpx = function (type, glob, options) {
    const _cpx = require('cpx');
    const cp = argv.watch ? _cpx.watch : _cpx.copy;
    const source = path.resolve(indir, glob);
    options = options || {};
    const cpx = cp(source, outdir, options);
    if (argv.verbose) {
        cpx.on('copy', event => {
            console.log(`[${type}] copied: ${path.resolve(event.srcPath)} -> ${path.resolve(event.dstPath)}`);
        });
        cpx.on('remove', event => {
            console.log(`[${type}] removed: ${path.resolve(event.path)}`);
        });
    }
};

const globAndWatch = function (type, inPattern, callback) {
    const glob = require('glob');
    const pattern = path.resolve(indir, inPattern);
    glob(pattern, function (err, matches) {
        if (err) {
            console.error(`[${type}] invalid pattern '${pattern}': ${err}`);
            process.exit(-1);
        }
        matches.forEach(callback);
    });
    if (argv.watch) {
        const gaze = require('gaze');
        gaze(pattern, function (err) {
            if (err) {
                console.error(`[${type}] unable to watch: ${err}`);
                process.exit(-1);
            }
            this.on('changed', callback);
        });
    }
};

if (argv.html) {
    const through2 = require('through2');
    const processEnvRE = /\{\{process\.env\.(.+?)\}\}/g;
    const options = {};
    options.transform = [];
    options.transform.push(function () {
        let data = '';
        return through2(function (chunk, _, callback) {
            data += chunk.toString();
            callback();
        }, function (callback) {
            data = data.replace(processEnvRE, function (expr, g1) {
                return process.env[g1] || '';
            });
            this.push(data);
            callback();
        });
    });
    if (argv['inline-css']) {
        const glob = require('glob');
        const juice = require('juice');
        const inlineCssFilepaths = glob.sync(path.resolve(indir, argv['inline-css']));
        options.transform.push(function (filepath) {
            if (inlineCssFilepaths.includes(path.resolve(filepath))) {
                let data = '';
                return through2(function (chunk, _, callback) {
                    data += chunk.toString();
                    callback();
                }, function (callback) {
                    const thisStream = this;
                    juice.juiceResources(data, {}, function (err, data) {
                        if (err) {
                            console.error(`[ html] unable to inline CSS from ${filepath}: ${err}`);
                        } else {
                            thisStream.push(data);
                        }
                        callback();
                    });
                });
            } else {
                return through2();
            }
        });
    }
    if (argv.minify) {
        const minify = require('html-minifier').minify;
        options.transform.push(function () {
            let data = '';
            return through2(function (chunk, _, callback) {
                data += chunk.toString();
                callback();
            }, function (callback) {
                data = minify(data, {collapseWhitespace: true});
                this.push(data);
                callback();
            });
        });
    }
    copyWithCpx(' html', argv.html, options);
}

if (argv.raw) {
    copyWithCpx('  raw', argv.raw);
}

if (argv.js) {
    const compile = function (filepath) {
        const browserify = require('browserify');
        const babelify = require('babelify');
        const envify = require('envify');
        const presetenv = require('babel-preset-env');
        const entry = path.resolve(filepath);
        const baseFile = path.basename(filepath, path.extname(filepath));
        const outFile = path.resolve(outdir, baseFile + '.js');
        const b = browserify(entry, {cache: {}, packageCache: {}});
        b.transform(envify);
        const babelifyOptions = {presets: [presetenv], plugins: []};
        if (argv.minify) {
            const angularjsannotate = require('babel-plugin-angularjs-annotate');
            babelifyOptions.plugins.push(angularjsannotate);
        }
        b.transform(babelify, babelifyOptions);
        if (argv.minify) {
            const uglifyify = require('uglifyify');
            b.transform(uglifyify);
            b.transform(uglifyify, {global: true});
        }
        if (argv.watch) {
            const watchify = require('watchify');
            b.plugin(watchify);
        }
        const bundle = function () {
            const s = b.bundle().pipe(fs.createWriteStream(outFile));
            if (argv.verbose) {
                s.on('finish', function () {
                    console.log(`[   js] compiled: ${entry} -> ${outFile}`);
                });
            }
        };
        b.on('update', bundle);
        bundle();
    };
    const glob = require('glob');
    const pattern = path.resolve(indir, argv.js);
    glob(pattern, function (err, matches) {
        if (err) {
            console.error(`[   js] invalid pattern '${pattern}': ${err}`);
            process.exit(-1);
        }
        matches.forEach(compile);
    });
}

if (argv.sass) {
    const render = function (filepath) {
        const file = path.resolve(filepath);
        const baseFile = path.basename(filepath, path.extname(filepath));
        const outFile = path.resolve(outdir, baseFile + '.css');
        const outputStyle = argv.minify ? 'compressed' : 'expanded';
        const sass = require('node-sass');
        sass.render({
            file,
            outFile,
            outputStyle
        }, function (err, res) {
            if (err) {
                console.error(`[ sass] unable to render ${file} into ${outFile}: ${err}`);
                // process.exit(-1);
                return;
            }
            fs.writeFile(outFile, res.css, function (err) {
                if (err) {
                    console.error(`[ sass] unable to write unto ${outFile}: ${err}`);
                    // process.exit(-1);
                    return;
                }
                if (argv.verbose) {
                    console.log(`[ sass] rendered: ${file} -> ${outFile}`);
                }
            });
        });
    };
    globAndWatch(' sass', argv.sass, render);
}

if (argv.less) {
    const render = function (filepath) {
        const file = path.resolve(filepath);
        const baseFile = path.basename(filepath, path.extname(filepath));
        const outFile = path.resolve(outdir, baseFile + '.css');
        const options = {
            compress: argv.minify
        };
        const input = fs.readFileSync(file, 'utf-8');
        const less = require('less');
        less.render(input, options, function (err, res) {
            if (err) {
                console.error(`[ less] unable to render ${file} into ${outFile}: ${err}`);
                // process.exit(-1);
                return;
            }
            fs.writeFile(outFile, res.css, function (err) {
                if (err) {
                    console.error(`[ less] unable to write unto ${outFile}: ${err}`);
                    // process.exit(-1);
                    return;
                }
                if (argv.verbose) {
                    console.log(`[ less] rendered: ${file} -> ${outFile}`);
                }
            });
        });
    };
    globAndWatch(' sass', argv.less, render);
}

if (argv.serve) {
    const httpServer = require('http-server');
    const port = parseInt(argv.serve) || 8080;
    const server = httpServer.createServer({
        root: outdir,
        cache: 1
    });
    server.listen(port, '0.0.0.0', function () {
        if (argv.verbose) {
            console.log(`[serve] serving: ${outdir} -> localhost:${port}`);
        }
    })
}
