let x = {
    trace: [],
    step: function(log, db) {
        this.trace.push({
            "input": log.contract.getInput()
        });
    },
    result: function(ctx, db) {
        return this.trace;
    },
    fault: function(log, db) {
        this.step(log, db);
    }
}
