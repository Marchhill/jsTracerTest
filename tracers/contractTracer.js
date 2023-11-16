let x = {
    trace: {},
    setup: function(config) {
        this.trace["contract"] = [];
        this.logContract = true;
    },
    enter: function(callFrame) {
        this.logContract = true;
    },
    exit: function(frameResult) {
        this.logContract = true;
    },
    step: function(log, db) {
        if (log.getError() === undefined) {
            let contractAddress = log.contract.getAddress();

            if (this.logContract) {
                this.trace["contract"].push({
                    "caller": log.contract.getCaller(),
                    "address": toAddress(toHex(contractAddress)),
                });
                this.logContract = false;
            }
        }
    },
    postStep: function(log, db) {},
    result: function(ctx, db) {
        return this.trace;
    },
    fault: function(log, db) {
        this.step(log, db);
    }
};