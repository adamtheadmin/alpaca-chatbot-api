import * as child_process from "child_process";
import fs from 'fs'
import {ChildProcessWithoutNullStreams} from "child_process";
import {Readable} from "stream";
import * as Buffer from "buffer";

class PassThrough extends Readable {
    _read(size) {}
}

const chatbot_path: string = process.env.CHATBOT_PATH;
const pathParts: string[] = chatbot_path.split('/');
const working_dir: string = pathParts.splice(0, pathParts.length - 1).join('/');

try {
    fs.accessSync(working_dir);
    process.chdir(working_dir);
} catch (e) {
    throw new Error(`Could not find working directory: ${working_dir}. Please set the CHATBOT_PATH env variable.`);
}

interface QueueItem {
    prompt: string;
    response: PassThrough;
}

export default new class {
    ready: boolean = false;
    responseStream: PassThrough;
    process: ChildProcessWithoutNullStreams;
    queue:  QueueItem[] = [];

    constructor() {
        this.process = child_process.spawn(chatbot_path, []);
        this.process.stdout.on('data', (bit:Buffer) => {
            const str = bit.toString();
            if (str.includes('>')) {
                this.responseStream?.push(null);
                this.responseStream = null;
                if (this.queue.length) {
                    const {prompt, response} = this.queue.shift();
                    this.sendPrompt(prompt, response);
                } else {
                    this.ready = true;
                }
            }
            if (this.responseStream) {
                this.responseStream.push(str.replace('>', '').replace("\u001b[1m\u001b[32m\u001b[0m", ""));
            }
        });
    }

    private sendPrompt(prompt:string, useStream?: PassThrough):PassThrough {
        console.log(`Q: ${prompt}`);
        this.ready = false;
        this.process.stdin.write(prompt + '\r\n');
        this.responseStream = useStream ? useStream : new PassThrough();
        process.stdout.write("A: ");
        this.responseStream.on('data', chunk => process.stdout.write(chunk));
        return this.responseStream;
    }

    private cleanseTerminalInput(input: string) :string {
        return input.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim();
    }

    sanitizeInput(input: string): string {
        return input.replace(/(\r\n|\n|\r)/gm, ' ');
    }

    ask(prompt:string):Readable {
        prompt = this.sanitizeInput(prompt);
        if (this.ready) {
            return this.sendPrompt(prompt);
        }
        const stream = new PassThrough();
        this.queue.push({
            response: stream,
            prompt
        });
        return stream;
    }

    async asyncAsk(prompt: string):Promise<string> {
        const stream = this.ask(prompt);
        let buffer = '';
        stream.on('data', (bit: Buffer) => buffer += bit.toString());
        return new Promise((resolve) => {
           stream.on('end', () => resolve(this.cleanseTerminalInput(buffer)));
        });
    }
}
