var sync = require('./arg-wait');
var fs = require('fs'), path = require('path');

// recursively traverse a directory, enumerating all files.
function walkDir(basedir, fileCB, doneCB) {
    var s = sync();
    function walk(dir) {
        fs.readdir(dir, s.arg());
        s.then(function (ents) {
            ents.forEach(function (file) {
                var rel = path.join(dir, file);
                fs.stat(rel, s.arg());
                s.then(function (stat) {
                    if (stat.isDirectory()) {
                        walk(rel);
                    } else {
                        fileCB(rel, stat, s.pend());
                    }
                });
            });
        });
    }
    walk(basedir);
    s.wait(doneCB);
    s.error(function(err){ throw err; });
}

walkDir(process.argv[2]||'.',
    function(f,s,cb){ console.log(f+' : '+s.size); cb(); },
    function(){ console.log("DONE"); });
