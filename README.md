Deal with lots of async
-----------------------

An instance of arg-wait represents a set of async tasks running in parallel.
The set of tasks can be extended while the tasks are running.

Wait handlers can be scheduled to run once the set of tasks becomes empty.
These handlers can, in turn, add new tasks to the set that will complete
before subsequent wait handlers run.

NB. while the happy paths are working nicely, the interaction between multiple
wait() and error() handlers are not well-specified yet.

```
var sync = require('arg-wait');
var s = sync(); // create an instance.
```

Use ```s.arg()``` as the callback for an async operation.

Queue up one or more ```s.arg()``` or ```s.group()``` of args, then schedule
a callback with ```then(fn)``` that will be passed those arguments in the
order of the arg/group calls.

```
fs.readFile("file1", s.arg());
fs.readFile("file2", s.arg());
s.then(function (buffer1, buffer2) {
    // use the buffers.
});
```

Callbacks can use ```arg()```, ```group()``` and ```then(fn)``` to extend
the set of pending tasks.

Use ```pend()``` as the callback for an async operation to include it without
capturing its result as an argument; errors will still be handled.

```
fs.writeFile("out", buffer, s.pend());
```

If any ```arg()``` or ```pend()``` is called back with an error, the
first ```error(fn)``` callback will run, and all pending wait() callbacks
will be discarded (likely to change: perhaps all wait() callbacks registered
before that error callback will be discarded; a finally-callback would also be handy.)

Example:

```
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
    s.wait(doneCB);  // does not pass any arguments.
    s.error(doneCB); // will pass error as the first argument.
}
```

Use group() to create an array argument for the next then() callback.
It returns a function that should be called N times to create N
callback functions for N async operations.

```
var g = s.group();
fileList.forEach(function(filename){
    fs.readFile(filename, g());
});
s.then(function(files){
    // files is an array of buffers.
});
```

API docs to follow.
There is some documentation in the source comments.
