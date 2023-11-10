import WebSocket from 'ws';
import http from 'http';
import {diff} from 'deep-object-diff';

// for subscribing to new transactions
const WEBSOCKET_CLIENT_IP = '127.0.0.1:8545';

// traces transactions with HTTP POST on these nodes
const NETHERMIND_SEPOLIA_LOCAL = ['nethermind', '127.0.0.1:8545'];
const GETH_SEPOLIA = ['geth', '45.79.222.129:8545'];
const GETH_MAINNET = ['geth', '170.187.146.103:8545'];
const NETHERMIND_MAINNET = ['nethermind', '170.187.146.163:8545'];

const TRACERS = ['{trace:{},randomAddress:Array(19).fill(87).concat([1]),setup:function(t){this.trace.config=t,this.trace.step=[],this.trace.callStack=[],this.count=0,this.hash=toWord(Array(31).fill(1).concat([1])),this.previousStackLength=0,this.previousMemoryLength=0},enter:function(t){this.trace.callStack.push({enter:{type:t.getType(),from:t.getFrom(),to:t.getTo(),input:t.getInput(),gas:t.getGas(),value:t.getValue()}})},exit:function(t){this.trace.callStack.push({exit:{gasUsed:t.getGasUsed(),output:t.getOutput(),error:t.getError()}})},step:function(t,e){if(void 0===t.getError()){t.contract.getAddress();let e=t.stack.length(),r=(e>0&&t.stack.peek(0),e>0&&t.stack.peek(0).valueOf(),e>0&&t.stack.peek(0).toString(16),e>0&&t.stack.peek(e-1),t.memory.length()),s=r>this.previousMemoryLength;s&&t.memory.slice(Math.max(this.previousMemoryLength,r-10),r),s&&r>=32&&t.memory.getUint(r-32);this.count,this.previousStackLength=e,this.previousMemoryLength=r,this.count++}else this.trace.step.push({error:t.getError()})},result:function(t,e){toAddress(toHex(t.to));return this.trace},fault:function(t,e){this.step(t,e)}}'];

const DEFAULT_CLIENT_PORT = '8545';

class TransactionListener {
    constructor(url) {
        this.ws = new WebSocket("ws://" + url);
        this.ws.on('open', this.#onOpen);
        this.ws.on('message', this.#onMessageReceived);
        this.ws.on('error', console.error);
        this.transactionCallback = (tx) => {};
    }

    setTransactionCallback(transactionCallback) {
        this.transactionCallback = transactionCallback;
        console.log("Listening for blocks...")
    }

    #onOpen = () => {
        this.ws.send('{"id": 1, "jsonrpc": "2.0", "method": "eth_subscribe", "params": ["newHeads"]}');
    }

    #onMessageReceived = (data) => {
        const res = JSON.parse(data);
        if ("method" in res && res["method"] == "eth_subscription") {
            console.log("New block, verifying tracer outputs match...");
            let transactions = res["params"]["result"]["transactions"];
            if (transactions.length > 0) {
                this.transactionCallback(transactions[0]);
            }

            // compares all transactions instead of just one
            // for (const tx of res["params"]["result"]["transactions"]) {
            //     this.transactionCallback(tx);
            // }
        }
    }
}

class Tracer {
    constructor(url, tracerCode, name = "") {
        this.tracerCode = tracerCode;
        this.name = name;

        url = url.split(":")
        this.reqParams = {
            host: url[0],
            port: url.length > 0 ? url[1] : DEFAULT_CLIENT_PORT,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        };
    }

    #post(data, onResponse) {
        const req = http.request(this.reqParams, (res) => {
            let receivedData = '';

            res.on('data', function(chunk) {
                receivedData += chunk;
            });

            res.on('end', function() {
                onResponse(JSON.parse(receivedData));
            });
        });

        req.write(data);
        req.end();
    }

    traceTransaction(tx, onResponse) {
        this.#post('{"jsonrpc": "2.0", "id": 1, "method": "debug_traceTransaction", "params": ["' + tx + '", {"tracer": "' + this.tracerCode + '"}]}', (res) => {
            if (res["error"] !== undefined) {
                console.log(this.name + " : " + tx);
                console.log(res);
                // console.log(this.name + " : " + res["error"]["message"]);
            }
            onResponse(res["result"]);
        });
    }
}


class TraceComparator {
    constructor([name1, ip1], [name2, ip2], tracers) {
        this.tracers = [];
        for (const tracer of tracers) {
            this.tracers.push([new Tracer(ip1, tracer, name1), new Tracer (ip2, tracer, name2)]);
        }
    }
    
    #compareTraces(tx, trace1, trace2) {
        if (trace1 === undefined || trace2 === undefined) {
            console.log('Error detected for transaction ' + tx);
            return;
        }

        if (JSON.stringify(trace1) != JSON.stringify(trace2)) {
            console.log('Conflicting traces for transaction ' + tx);
            let traceDiff = diff(trace1, trace2);
            console.log("diff: " + JSON.stringify(traceDiff));
            if ('step' in traceDiff) {
                console.log("step diff:");
                for (const instrNumber in traceDiff['step']) {
                    console.log("nethermind #" + instrNumber + " : " + JSON.stringify(trace1['step'][instrNumber]));
                    console.log("geth #" + instrNumber + " : " + JSON.stringify(trace2['step'][instrNumber]));
                }
            }
            // console.log('nethermind: ' + JSON.stringify(trace1));
            // console.log('geth: ' + JSON.stringify(trace2));
        }
        else {
            console.log('Outputs match for ' + tx);
        }
    }

    #runTracers(tx, tracer1, tracer2) {
        return Promise.all([
            new Promise((resolve, reject) => tracer1.traceTransaction(tx, (res => resolve(res)))),
            new Promise((resolve, reject) => tracer2.traceTransaction(tx, (res => resolve(res))))
        ]);
    }

    onTransaction = (tx) => {
        // wait to give all nodes time to process latest block
        setTimeout(() => {
            for (const [tracer1, tracer2] of this.tracers) {
                this.#runTracers(tx, tracer1, tracer2)
                    .then(([trace1, trace2]) => this.#compareTraces(tx, trace1, trace2));
            }
        }, 2000);
    }
}

const traceComparator = new TraceComparator(NETHERMIND_SEPOLIA_LOCAL, GETH_SEPOLIA, TRACERS);
const transactionListener = new TransactionListener(WEBSOCKET_CLIENT_IP);
transactionListener.setTransactionCallback(traceComparator.onTransaction);