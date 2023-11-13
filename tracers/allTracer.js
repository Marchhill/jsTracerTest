let x = {
    trace: {},
    randomAddress: Array(19).fill(87).concat([1]),
    setup: function(config) {
        this.trace["config"] = config;
        this.trace["step"] = [];
        this.trace["callStack"] = [];
        this.count = 0;
        this.hash = toWord(Array(31).fill(1).concat([1]));
        this.previousStackLength = 0;
        this.previousMemoryLength = 0;
    },
    enter: function(callFrame) {
        this.trace["callStack"].push({
            "enter": {
                "type": callFrame.getType(),
                "from": callFrame.getFrom(),
                "to": callFrame.getTo(),
                "input": callFrame.getInput(),
                "gas": callFrame.getGas(),
                "value": callFrame.getValue()
            }
        });
    },
    exit: function(frameResult) {
        this.trace["callStack"].push({
            "exit": {
                "gasUsed": frameResult.getGasUsed(),
                "output": frameResult.getOutput(),
                "error": frameResult.getError()
            }
        });
    },
    step: function(log, db) {
        if (log.getError() === undefined) {
            let contractAddress = log.contract.getAddress();

            let currentStackLength = log.stack.length();
            let topStackItem = currentStackLength > 0 ? log.stack.peek(0) : 0;
            let topStackItemValueOf = currentStackLength > 0 ? log.stack.peek(0).valueOf() : 0;
            let topStackItemToString = currentStackLength > 0 ? log.stack.peek(0).toString(16) : 0;
            let bottomStackItem = currentStackLength > 0 ? log.stack.peek(currentStackLength - 1) : 0;

            let currentMemoryLength = log.memory.length();
            let memoryExpanded = currentMemoryLength > this.previousMemoryLength;
            let newMemorySlice = memoryExpanded ? log.memory.slice(Math.max(this.previousMemoryLength, currentMemoryLength - 10), currentMemoryLength) : [];
            let newMemoryItem = memoryExpanded && currentMemoryLength >= 32 ? log.memory.getUint(currentMemoryLength - 32) : 0;

            if (this.count == 0) {
                this.trace["contract"] = {
                    "caller": log.contract.getCaller(),
                    "address": toAddress(toHex(contractAddress)),
                    "value": log.contract.getValue(),
                    "input": log.contract.getInput(),
                    "balance": db.getBalance(contractAddress),
                    "nonce": db.getNonce(contractAddress),
                    "code": db.getCode(contractAddress),
                    "state": db.getState(contractAddress, this.hash),
                    "stateString": db.getState(contractAddress, this.hash).toString(16),
                    "exists": db.exists(contractAddress),
                    "randomexists": db.exists(this.randomAddress)
                };
            }

            this.trace["step"].push({
                "op": {
                    "isPush": log.op.isPush(),
                    "asString": log.op.toString(),
                    "asNumber": log.op.toNumber()
                },
                "stack": {
                    "top": topStackItem,
                    "topValueOf": topStackItemValueOf,
                    "topToString": topStackItemToString,
                    "bottom": bottomStackItem,
                    "length": currentStackLength
                },
                "memory": {
                    "newSlice": newMemorySlice,
                    "newMemoryItem": newMemoryItem,
                    "length": currentMemoryLength
                },
                "pc": log.getPC(),
                "gas": log.getGas(),
                "cost": log.getCost(),
                "depth": log.getDepth(),
                "refund": log.getRefund()
            });
            this.previousStackLength = currentStackLength;
            this.previousMemoryLength = currentMemoryLength;
            this.count++;
        }
        else {
            this.trace["step"].push({"error": log.getError()});
        }
    },
    postStep: function(log, db) {
        let lastStep = this.trace["step"].at(-1);
        if (lastStep["cost"] !== undefined) {
            lastStep["cost"] = log.getCost();
            lastStep["refund"] = log.getRefund();
        }
    },
    result: function(ctx, db) {
        let ctxToAddress = toAddress(toHex(ctx.to));
        this.trace["result"] = {
            "ctx": {
                "type": ctx.type,
                "from": ctx.from,
                "to": ctx.to,
                "input": ctx.input,
                "gas": ctx.gas,
                "gasUsed": ctx.gasUsed,
                "gasPrice": ctx.gasPrice,
                "value": ctx.value,
                "block": ctx.block,
                "output": ctx.output,
                "error": ctx.error
            },
            "db": {
                "balance": db.getBalance(ctxToAddress),
                "nonce": db.getNonce(ctxToAddress),
                "code": db.getCode(ctxToAddress),
                "state": db.getState(ctxToAddress, this.hash),
                "exists": db.exists(ctxToAddress),
                "randomexists": db.exists(this.randomAddress)
            }
        };
        return this.trace;
    },
    fault: function(log, db) {
        this.step(log, db);
    }
}