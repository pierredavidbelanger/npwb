#!/usr/bin/env node

require('dotenv').config();

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
            console.error(`[${type}] invalid pattern '${pattern}':`, err);
            process.exit(-1);
        }
        matches.forEach(callback);
    });
    if (argv.watch) {
        const gaze = require('gaze');
        gaze(pattern, function (err) {
            if (err) {
                console.error(`[${type}] unable to watch:`, err);
                process.exit(-1);
            }
            this.on('changed', callback);
        });
    }
};

const makeOutFile = function (inFile, outExtname) {
    const outInFile = path.resolve(outdir, path.relative(indir, inFile));
    const outDir = path.dirname(outInFile);
    mkdirp.sync(outDir);
    const outFileBasename = path.basename(outInFile, path.extname(outInFile));
    return path.resolve(outDir, outFileBasename + outExtname);
};

if (argv.html) {
    globAndWatch(' html', argv.html, function (inFile) {

        const outFile = makeOutFile(inFile, '.html');

        const dataInlineAsset = {
            resolve: function (node) {
                return node.tag === 'link' && node.attrs && node.attrs['data-inline-asset'] === 'true' && node.attrs.href;
            },
            transform: function (node, {buffer, from}) {
                delete node.attrs['data-inline-asset'];
                if (path.extname(from) === '.scss') {
                    return new Promise(function (resolve, reject) {
                        const sass = require('node-sass');
                        sass.render({
                            data: buffer.toString('utf8'),
                            includePaths: [path.dirname(from)],
                            outFile: makeOutFile(from, '.css'),
                            outputStyle: argv.minify ? 'compressed' : 'expanded'
                        }, function (err, res) {
                            if (err) {
                                return reject(err);
                            }
                            if (argv.verbose) {
                                console.log(`[ html] rendered and inline sass asset: ${from} -> ${outFile}`);
                            }
                            delete node.attrs.href;
                            delete node.attrs.rel;
                            node.tag = 'style';
                            node.content = [res.css.toString('utf8')];
                            resolve();
                        });
                    });
                }
            }
        };

        const noopTransform = {
            resolve: function () {
                return false;
            }
        };

        const posthtmlPlugins = [];

        posthtmlPlugins.push(require('posthtml-inline-assets')({
            cwd: path.dirname(inFile),
            transforms: {
                image: noopTransform,
                script: noopTransform,
                style: noopTransform,
                dataInlineAsset
            }
        }));

        posthtmlPlugins.push(function (tree) {
            const render = require('posthtml-render');
            const parser = require('posthtml-parser');
            let html = render(tree);
            html = html.replace(/\{\{process\.env\.(.+?)\}\}/g, function (expr, g1) {
                return process.env[g1] || '';
            });
            tree = parser(html);
            return tree;
        });

        posthtmlPlugins.push(function (tree) {
            let inlineStyle = false;
            tree.match({tag: 'html'}, function (node) {
                if (node.attrs && node.attrs['data-inline-style'] === 'true') {
                    delete node.attrs['data-inline-style'];
                    inlineStyle = true;
                }
                return node;
            });
            if (inlineStyle) {
                const render = require('posthtml-render');
                const parser = require('posthtml-parser');
                const juice = require('juice');
                let html = render(tree);
                html = juice(html);
                if (argv.verbose) {
                    console.log(`[ html] inline style node into style attr: ${outFile}`);
                }
                tree = parser(html);
            }
            return tree;
        });

        if (argv.minify) {
            posthtmlPlugins.push(function (tree) {
                const render = require('posthtml-render');
                const parser = require('posthtml-parser');
                const minify = require('html-minifier').minify;
                let html = render(tree);
                html = minify(html, {
                    collapseWhitespace: true,
                    removeComments: true,
                    minifyCSS: true
                });
                tree = parser(html);
                return tree;
            });
        }

        const posthtml = require('posthtml')(posthtmlPlugins);

        const input = fs.readFileSync(inFile, 'utf-8');

        posthtml.process(input).then(function (result) {

            const output = result.html;

            fs.writeFile(outFile, output, function (err) {
                if (err) {
                    console.error(`[ html] unable to write unto ${outFile}:`, err);
                    return;
                }
                if (argv.verbose) {
                    console.log(`[ html] processed: ${inFile} -> ${outFile}`);
                }
            });
        });
    });
}

if (argv.raw) {
    copyWithCpx('  raw', argv.raw);
}

if (argv.js) {

    const compile = function (filepath) {

        const outFile = makeOutFile(filepath, '.js');

        const browserify = require('browserify');
        const b = browserify(filepath, {cache: {}, packageCache: {}});

        const presetenv = require('@babel/preset-env');
        const babelifyOptions = {presets: [presetenv], plugins: []};

        if (argv.vuejsx) {
            const presetjsx = require('@vue/babel-preset-jsx');
            babelifyOptions.presets.push(presetjsx);
        }

        if (argv.minify && argv.angularjs) {
            const angularjsannotate = require('babel-plugin-angularjs-annotate');
            babelifyOptions.plugins.push(angularjsannotate);
        }

        const envify = require('envify');
        b.transform(envify);

        const babelify = require('babelify');
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
            const s = b.bundle().on('error', function (err) {
                console.error(`[   js] unable to compile ${filepath}:`, err.toString());
            }).pipe(fs.createWriteStream(outFile));
            if (argv.verbose) {
                s.on('finish', function () {
                    console.log(`[   js] compiled: ${filepath} -> ${outFile}`);
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
            console.error(`[   js] invalid pattern '${pattern}':`, err);
            process.exit(-1);
        }
        matches.forEach(compile);
    });
}

if (argv.sass) {
    const render = function (filepath) {
        const outFile = makeOutFile(filepath, '.css');
        const outputStyle = argv.minify ? 'compressed' : 'expanded';
        const sass = require('node-sass');
        sass.render({
            file: filepath,
            outFile,
            outputStyle
        }, function (err, res) {
            if (err) {
                console.error(`[ sass] unable to render ${filepath} into ${outFile}:`, err);
                // process.exit(-1);
                return;
            }
            fs.writeFile(outFile, res.css, function (err) {
                if (err) {
                    console.error(`[ sass] unable to write unto ${outFile}:`, err);
                    // process.exit(-1);
                    return;
                }
                if (argv.verbose) {
                    console.log(`[ sass] rendered: ${filepath} -> ${outFile}`);
                }
            });
        });
    };
    globAndWatch(' sass', argv.sass, render);
}

if (argv.less) {
    const render = function (filepath) {
        const outFile = makeOutFile(filepath, '.css');
        const options = {
            compress: argv.minify
        };
        const input = fs.readFileSync(filepath, 'utf-8');
        const less = require('less');
        less.render(input, options, function (err, res) {
            if (err) {
                console.error(`[ less] unable to render ${filepath} into ${outFile}:`, err);
                // process.exit(-1);
                return;
            }
            fs.writeFile(outFile, res.css, function (err) {
                if (err) {
                    console.error(`[ less] unable to write unto ${outFile}:`, err);
                    // process.exit(-1);
                    return;
                }
                if (argv.verbose) {
                    console.log(`[ less] rendered: ${filepath} -> ${outFile}`);
                }
            });
        });
    };
    globAndWatch(' sass', argv.less, render);
}

if (argv.serve) {
    const httpServer = require('http-server-legacy');
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
