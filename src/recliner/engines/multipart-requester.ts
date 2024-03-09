import { HttpHeader } from "../interfaces";
import { FlattenObject, Utils } from "../utils";

export class MultipartRemoteRequester{

    private _attachments: {[key:string]:Blob}={};

    constructor(private document:FlattenObject, 
        private _boundary:string ){  
    }

    append(attachment_name:string,attachmentBlob: Blob){
        this._attachments[attachment_name]=attachmentBlob;
    }
    private getSize(){
        const newline="\r\n";
        let s =0;
        try{
            s=s+(`--${this._boundary}\r\n`).length;
            s=s+("Content-Type: application/json\r\n\r\n").length;
            s=s+(JSON.stringify(this.document)).length;
            s=s+(newline).length;
            for(let a of Object.keys(this._attachments)){
                const blob = this._attachments[a];
                s=s+(`--${this._boundary}\r\n`).length;
                s=s+(`Content-Disposition: attachment; filename="${a}"\r\n`).length;
                s=s+(`Content-Type: ${blob.type}\r\n`).length;
                s=s+(`Content-Length: ${blob.size}`).length;
                s=s+(newline).length;
                s=s+(newline).length;
                
                s=s+blob.size;
                //controller.enqueue(await blob.arrayBuffer());
                s=s+(newline).length;
            }
            s=s+(`--${this._boundary}--\r\n`).length;
        }catch(e){
            console.error(e);
            throw e;
        }
        return s;
    }

    private getReadableStream():ReadableStream{
        const newline="\r\n";

        const r = new ReadableStream({
            start:async (controller:ReadableStreamDefaultController)=>{
                try{
                    controller.enqueue(`--${this._boundary}\r\n`);
                    controller.enqueue("Content-Type: application/json\r\n\r\n");
                    controller.enqueue(JSON.stringify(this.document));
                    controller.enqueue(newline);
                    for(let a of Object.keys(this._attachments)){
                        const blob = this._attachments[a];
                        controller.enqueue(`--${this._boundary}\r\n`);
                        controller.enqueue(`Content-Disposition: attachment; filename="${a}"\r\n`);
                        controller.enqueue(`Content-Type: ${blob.type}\r\n`);
                        controller.enqueue(`Content-Length: ${blob.size}`);
                        controller.enqueue(newline);
                        controller.enqueue(newline);
                        
                        // const r = blob.stream().getReader();
                        // await new Promise<void>(res=>{
                        //     return pump();
                        //     function pump(){
                        //         r.read().then(({done,value})=>{
                        //             // When no more data needs to be consumed, close the stream
                        //             if (done) {
                        //                 return res();
                        //             }
                        //             // Enqueue the next data chunk into our target stream
                        //             controller.enqueue(value);
                        //             return pump();
                        //         })
                        //     };
                        // });
                        controller.enqueue(blob);
                        controller.enqueue(newline);
                    }
                    controller.enqueue(`--${this._boundary}--\r\n`);
                }catch(e){
                    console.error(e);
                }finally{
                    controller.close();
                }
            }
        });
        return r;
    }

    async readStream(stream: ReadableStream) {
        const reader = stream.getReader();
        let charsReceived = 0;
        let e ="";
        // read() returns a promise that resolves
        // when a value has been received
        return await reader.read().then(function processText({ done, value }):Promise<void> {
          // Result objects contain two properties:
          // done  - true if the stream has already given you all its data.
          // value - some data. Always undefined when done is true.
          if (done) {
            console.log("Stream complete");
            console.log(e);
            return;
          }
      
          charsReceived += value.length;
          const chunk = value;
          e += chunk;
      
          // Read some more, and call this function again
          return reader.read().then(processText);
        });
      }

    async placeRequest(url:string, headers: HttpHeader):Promise<Response>{
        const r = this.getReadableStream();
        const t = r.tee();
        await this.readStream(t[0]);
        
        const res = await fetch(url,{
            method: "PUT",
            headers: Utils.combine_headers(headers,{
                "transfer-encoding":"chunked",
                'Content-Type':`multipart/related; boundary="--${this._boundary}"`
            }),
            body: t[1]
        })
        return res;
    }
}