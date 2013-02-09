arg-wait
========

Deal with lots of async.
------------------------

A small utility for dealing with lots of async tasks.

Use arg() as the callback for an async operation.

Queue up one or more arg() or group() of args, then schedule a callback
with then() that will be passed those arguments.

Callbacks can queue up more args and callbacks.

Once all queued callbacks have completed, the first wait() callback will
run. This callback can queue up new work that will complete before the
next wait() callback runs.

If any arg() is called back with an error, the first error() callback
will run, and all pending wait() callbacks will be discarded (subject to
change: perhaps all wait() callbacks registered before that error
callback will be discarded; a finally-callback would also be handy.)

Use pend() to wait on an async operation without capturing its result
as an argument; errors will still be handled.

Example:

```
var sync = require('arg-wait');

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
```

Use group() to create an array argument for the next then() callback.
It returns a function that should be called N times to create N
callback functions for N async operations.

```
var s = sync(), g = s.group();
fileList.forEach(function(filename){
    fs.readFile(filename, g());
});
s.then(function(files){
    // files is an array of buffers.
});
```
