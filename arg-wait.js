// important features:
// catch errors: avoid server crashes.
// nesting: avoid building lists of nested async ops.

module.exports = sync;

var debug = false;

function sync() {
    var pending = 0, gen = 0, current = {args:[], wait:0}, pend_err, catches, waits;

    function arg() {
        // create a callback(error,result) function that forwards its result
        // to the next positional argument of the following then-callback.
        // capture both the args array and the next free argument index.
        var c = current, args = c.args, slot = args.length;
        args[slot] = null; // reserve the slot.
        c.wait++; // wait for one more argument callback.
        if (debug) console.log("-- arg", c.wait);
        function sync_arg_cb(err, res) {
            if (err) {
                handle_error(err);
            } else {
                args[slot] = res;
                if (!--c.wait) resume(c);
            }
        }
        return sync_arg_cb;
    }

    function pass(val) {
        // forward a value as the next positional argument to the following
        // then-callback, waiting if the value is a sync() instance.
        if (debug) console.log("-- pass");
        if (val && val._is_sync) {
            // wait for the sync instance to drain and produce a value.
            (val.deps || (val.deps=[])).push(arg());
        } else {
            var args = current.args, slot = args.length;
            args[slot] = val; // resolve the argument now.
        }
    }

    function group() {
        // add an Array argument as the next positional argument of the following
        // then-callback; returns a function that must be called to reserve
        // each array element, which in turn returns the callback(error,result)
        // function for that array element.
        var c = current, args = c.args, items = [];
        args[args.length] = items; // populate the argument immediately.
        if (debug) console.log("-- group");
        function sync_group_item() {
            // create a callback(error,result) function that appends its result
            // to the currently active group argument.
            // XXX: guard against adding items after wait drops to zero
            // (i.e. after the then-callback has been called)
            var slot = items.length;
            items[slot] = null; // reserve the slot.
            c.wait++; // wait for one more argument callback.
            if (debug) console.log("-- group item", c.wait);
            function sync_item_cb(err, res) {
                if (err) {
                    handle_error(err);
                } else {
                    items[slot] = res;
                    if (!--c.wait) resume(c);
                }
            }
            return sync_item_cb;
        }
        return sync_group_item;
    }

    function then(fn) {
        // schedule a callback to run when all arguments are resolved.
        if (debug) console.log("-- then: "+(fn && fn.name));
        var c = current;
        c.then = fn;
        // start a new argument set for the next then handler.
        current = {args:[], wait:0};
        pending++; // wait for one more then-callback.
        if (!c.wait) resume(c);
    }

    function wait() {
        // create a callback(error) function that this sync instance will
        // wait on, handling any error produced.
        pending++; // wait for one more callback.
        if (debug) console.log("-- wait", pending);
        function sync_wait_cb(err) {
            if (err) {
                handle_error(err);
            } else {
                if (!--pending) drain();
            }
        }
        return sync_wait_cb;
    }

    function end(fn) {
        // wait for all pending contexts in this generation to finish,
        // including any args and callbacks scheduled by then-callbacks,
        // which will bump up the pending count.
        if (debug) console.log("-- end: "+(fn && fn.name));
        if (!pending) {
            try {
                fn();
            } catch (err) {
                handle_error(err);
            }
        } else {
            (waits || (waits=[])).push(fn);
        }
    }

    function error(fn) {
        // schedule an error check to catch any errors from previous callbacks.
        if (debug) console.log("-- error: "+(fn && fn.name));
        // XXX: decided these should cancel end() handlers that were scheduled
        // before this fn, but not those scheduled after; needs a way to indicate
        // whether the error was consumed.
        (catches || (catches=[])).push(fn);
        if (pend_err) {
            var err = pend_err; pend_err = null;
            handle_error(err);
        }
    }

    function handle_error(err) {
        // advance the generation so we'll ignore callbacks from any of the
        // pending args in the generation that caused the error.
        if (debug) console.log("-- handle_error", err);
        if (catches && catches.length) {
            var handler = catches.shift();
            gen++; pending = 0; current = {args:[], wait:0}; // start a new generation.
            try {
                handler(err); // run the error handler.
            } catch (err) {
                handle_error(err);
            }
        } else {
            pend_err = err; // keep the error for future .error(fn) calls.
            throw new Error("uncaught error: "+(err.stack||err.toString()));
        }
    }

    // run the then-callback for a context when its wait count reaches zero.
    function resume(c) {
        if (debug) console.log("-- resume", c);
        if (c.then) {
            // XXX: might have active args here that we need to save and
            // restore unless we delay this callback, which we should to
            // maintain invariant callback order anyway.
            try {
                c.then.apply(null, c.args);
            } catch (err) {
                handle_error(err);
            }
            if (!--pending) drain();
        }
    }

    // when sync queue is drained, run the waiting end-handlers.
    function drain() {
        if (debug) console.log("-- drained");
        gen++; current = {args:[], wait:0}; // start a new generation.
        var w = waits; waits = [];
        if (w) {
            // XXX: decided to run these one at a time, so they can add thens
            // before the next one runs.
            w.forEach(function(h){
                try {
                    h();
                } catch (err) {
                    handle_error(err);
                }
            });
        }
    }

    return {arg:arg, pass:pass, group:group, then:then, wait:wait, end:end, error:error, _is_sync:1};
}
