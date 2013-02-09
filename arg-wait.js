// important features:
// catch errors: avoid server crashes.
// nesting: avoid building lists of nested async ops.

module.exports = sync;

var uid = 1, debug = false;

function sync() {
    var pending = 0, gen = 0, current = {args:[], wait:0}, pend_err, catches, waits;

    function arg() {
        // create a callback(error,result) function that forwards its result
        // to the next positional argument of the following then-callback.
        // capture both the args array and the next free argument index.
        var c = current, args = c.args, slot = args.length;
        args[slot] = null; // reserve the slot.
        c.wait++; // wait for one more argument callback.
        if (debug) { if (!c.id) c.id=uid++; console.log("-- arg", c.id); }
        function sync_arg_cb(err, res) {
            if (err) {
                handle_error(err);
            } else {
                args[slot] = res;
                if (!--c.wait && c.then) resume(c);
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
            // XXX: wait() doesn't produce a value.
            var a = arg();
            val.wait(function(){ a(); });
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
        if (debug) { if (!c.id) c.id=uid++; console.log("-- group", c.id); }
        function sync_group_item() {
            // create a callback(error,result) function that appends its result
            // to the currently active group argument.
            // NB. cannot add group items after registering the then() callback,
            // because wait might have dropped to zero and scheduled it already.
            // XXX: loop-hole in then() with no function.
            if (c.then) throw new Error("cannot add group items after then() callback");
            var slot = items.length;
            items[slot] = null; // reserve the slot.
            c.wait++; // wait for one more argument callback.
            if (debug) console.log("-- group item", c.wait);
            function sync_item_cb(err, res) {
                if (err) {
                    handle_error(err);
                } else {
                    items[slot] = res;
                    if (!--c.wait && c.then) resume(c);
                }
            }
            return sync_item_cb;
        }
        return sync_group_item;
    }

    function then(fn) {
        // schedule a callback to run when all arguments are resolved.
        var c = current;
        if (debug) { if (!c.id) c.id=uid++; console.log("-- then "+c.id+" "+(fn && fn.name)); }
        c.then = fn; // ok if null/undefined.
        // start a new argument set for the next then handler.
        current = {args:[], wait:0};
        pending++; // wait for one more then-callback.
        // wait might already be zero if all the args were resolved before
        // this then() call, or if none of the args required waiting.
        // resume even if fn is null for consistent 'pending' handling.
        if (!c.wait) resume(c);
    }

    function pend() {
        // create a callback(error) function that this sync instance will
        // wait on before running the next then() callback, and handling
        // any error produced.
        pending++; // wait for one more callback.
        if (debug) console.log("-- pend", pending);
        function sync_wait_cb(err) {
            if (err) {
                handle_error(err);
            } else {
                if (!--pending) drain();
            }
        }
        return sync_wait_cb;
    }

    function wait(fn) {
        // schedule fn to run after all queued then() and pend() callbacks,
        // including any additional callbacks scheduled by those callbacks,
        // i.e. when the queue of callbacks is empty.
        if (debug) console.log("-- wait: "+(fn && fn.name));
        (waits || (waits=[])).push(fn);
        // wait for any args that might have been queued without a then()
        // to wait for them, since we promised to wait for everything.
        if (current.args.length) return then(); // will check pending.
        // the last drain() might have done nothing if there were no wait
        // functions pending when it happened, so check again.
        if (!pending) drain();
    }

    function error(fn) {
        // schedule an error check to catch any errors from previous callbacks.
        if (debug) console.log("-- error: "+(fn && fn.name));
        // XXX: decided these should cancel end() handlers that were scheduled
        // before this fn, but not those scheduled after; needs a way to indicate
        // whether the error was consumed.
        // XXX: should flush any unused args since this is "wait, for an error".
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
        // reset pending count and start a new generation, so we'll ignore
        // callbacks from any arg() and pend() handlers in-flight.
        gen++; pending = 0; current = {args:[], wait:0};
        if (catches && catches.length) {
            var handler = catches.shift();
            try {
                handler(err); // run the error handler.
                // flush any unused args queued in the callback.
                if (current.args.length) then();
            } catch (err) {
                handle_error(err);
            }
            // schedule the next wait() callback.
            if (!pending && waits.length) drain();
        } else {
            // pend_err = err; // keep the error for future .error(fn) calls.
            throw err;
        }
    }

    // run the then() callback for a context and end its pending state.
    function resume(c) {
        if (debug) console.log("-- resolved: "+c.id);
        process.nextTick(function(){
            if (debug) console.log("-- run then: "+c.id);
            // this "then" is no longer pending.
            pending--;
            // run the callback if one was attached.
            if (c.then) {
                try {
                    // pass arg() results to the then() callback.
                    c.then.apply(null, c.args);
                    // flush any unused args queued in the callback.
                    if (current.args.length) then();
                } catch (err) {
                    // take the error path and exit early.
                    return handle_error(err);
                }
            }
            // schedule the next wait() callback.
            if (!pending) { if (debug) console.log("pending in "+c.id); drain(); }
        });
    }

    // when sync queue is drained, run the waiting end-handlers.
    function drain() {
        if (debug) { try { throw new Error; } catch (e) { console.log("-- drained", e.stack); }}
        process.nextTick(function(){
            if (debug) console.log("-- run wait");
            // since we yielded, it's possible that some callback outside
            // of our control has queued new things between the time that
            // drain was called, and now; in that case go back to waiting.
            // XXX: but what if a queued arg caused an error?
            if (pending) return;
            // run the next wait() handler if any are queued.
            var fn = waits.shift();
            if (fn) {
                try {
                    fn();
                    // flush any unused args queued in the callback.
                    if (current.args.length) then();
                } catch (err) {
                    // take the error path and exit early.
                    return handle_error(err);
                }
                // schedule the next wait() callback.
                if (!pending && waits.length) drain();
            }
        });
    }

    return {arg:arg, pass:pass, group:group, then:then, pend:pend, wait:wait, error:error, _is_sync:1};
}
