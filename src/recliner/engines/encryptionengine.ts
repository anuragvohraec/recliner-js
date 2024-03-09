export class EncryptionEngine{
    private static textEncoder = new TextEncoder();

    static async sha1_hash(message: string):Promise<string>{
        const buffer = this.textEncoder.encode(message);
        let r = await crypto.subtle.digest("SHA-1",buffer);
        return EncryptionEngine.hex(r);
    }

    static async uuidRandom():Promise<string>{
        let r = await this.random_id();
        return await this.sha1_hash(r+Date.now());
    }

    static async random_id():Promise<string>{
        const buffer = crypto.getRandomValues(new Uint8Array(16));
        let r = await crypto.subtle.digest("SHA-1",buffer);
        return EncryptionEngine.hex(r)
    }

    private static  hex(buffer: ArrayBuffer) {
        var hexCodes = [];
        var view = new DataView(buffer);
        for (var i = 0; i < view.byteLength; i += 4) {
            // Using getUint32 reduces the number of iterations needed (we process 4 bytes each time)
            var value = view.getUint32(i)
            // toString(16) will give the hex representation of the number without padding
            var stringValue = value.toString(16)
            // We use concatenation and slice for padding
            var padding = '00000000'
            var paddedValue = (padding + stringValue).slice(-padding.length)
            hexCodes.push(paddedValue);
        }
        // Join all the hex strings into one
    
        return hexCodes.join("");
    }

    static  uuid() {

        // get sixteen unsigned 8 bit random values
        var u = crypto
          .getRandomValues(new Uint8Array(16));
      
        // set the version bit to v4
        u[6] = (u[6] & 0x0f) | 0x40
      
        // set the variant bit to "don't care" (yes, the RFC
        // calls it that)
        u[8] = (u[8] & 0xbf) | 0x80
      
        // hex encode them and add the dashes
        var uid = "";
        uid += u[0].toString(16);
        uid += u[1].toString(16);
        uid += u[2].toString(16);
        uid += u[3].toString(16);
        uid += "-";
      
        uid += u[4].toString(16);
        uid += u[5].toString(16);
        uid += "-";
      
        uid += u[6].toString(16);
        uid += u[7].toString(16);
        uid += "-";
      
        uid += u[8].toString(16);
        uid += u[9].toString(16);
        uid += "-";
      
        uid += u[10].toString(16);
        uid += u[11].toString(16);
        uid += u[12].toString(16);
        uid += u[13].toString(16);
        uid += u[14].toString(16);
        uid += u[15].toString(16);
      
        return uid;
      }
}