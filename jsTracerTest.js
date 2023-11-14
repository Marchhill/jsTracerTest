import WebSocket from 'ws';
import http from 'http';
import fs from 'fs';
import {diff} from 'deep-object-diff';
import {minify} from 'minify';
import tryToCatch from 'try-to-catch';

// for subscribing to new transactions
const WEBSOCKET_CLIENT_IP = '127.0.0.1:8545';

// traces transactions with HTTP POST on these nodes
const NETHERMIND_SEPOLIA_LOCAL = ['nethermind', '127.0.0.1:8545'];
const GETH_SEPOLIA = ['geth', '45.79.222.129:8545'];
const GETH_MAINNET = ['geth', '170.187.146.103:8545'];
const NETHERMIND_MAINNET = ['nethermind', '170.187.146.163:8545'];

const DEFAULT_CLIENT_PORT = '8545';

// load and minify tracer that tests all features
const [error, allTracer] = await tryToCatch(minify, 'tracers/allTracer.js', {"js": {"removeUnusedVariables": false}});
if (error) {
    console.error(error.message);
}

const TRACERS = [allTracer.slice(6, -1)];


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

    #outputDiff(tx, trace1, trace2) {
        let fileStream = fs.createWriteStream("./diffs/" + tx.slice(2) + ".diff");
        fileStream.once('open', (fd) => {
            let traceDiff = diff(trace1, trace2);
            fileStream.write("diff: " + JSON.stringify(traceDiff) + "\n");
            if ('step' in traceDiff) {
                fileStream.write("step diff:\n");
                for (const instrNumber in traceDiff['step']) {
                    fileStream.write("nethermind #" + instrNumber + " : " + JSON.stringify(trace1['step'][instrNumber]) + "\n");
                    fileStream.write("geth #" + instrNumber + " : " + JSON.stringify(trace2['step'][instrNumber]) + "\n");
                }
            }
            fileStream.write("nethermind: " + JSON.stringify(trace1) + "\n");
            fileStream.write("geth: " + JSON.stringify(trace2) + "\n");
        });
    }
    
    #compareTraces(tx, trace1, trace2) {
        if (trace1 === undefined || trace2 === undefined) {
            console.log('Error detected for transaction ' + tx);
            return;
        }

        if (JSON.stringify(trace1) != JSON.stringify(trace2)) {
            console.log('Conflicting traces for transaction ' + tx);
            this.#outputDiff(tx, trace1, trace2);
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