import { HttpHeader } from './interfaces';
import { R } from './recliner';

//Have to add $in
export type CondOps = "$lt"|"$lte"|"$eq"|"$ne"|"$gte"|"$gt"|"$exists"|"$within"|"$nin"|"$regex"|"$in"|"$isinpolygon"|"$isnotinpolygon"|"$nwithin";
const ConditionalOperators = new Set<string>(["$lt","$lte","$eq","$ne","$gte","$gt","$exists","$within","$nin","$regex","$in","$isinpolygon","$isnotinpolygon","$nwithin"]);


export type FlattenObject = {
    [key : string]: any;
};

export interface FlattenSelector{
    [key:string]:FlattenObject;
}

export class Utils {
    
    static sendCustomResponse(doc:any,status:number, mime:string, headers?: any){
        const _headers ={...headers, "Content-Type": mime };
        return new Response(doc,{headers: _headers, status: status});
    }

    /**
     * If has a rev/_rev field than it will add an Etag headers too on its own.
     * @param jsObject 
     * @param status 
     * @param statusText 
     */
    static sendJsonResponse<J>(jsObject: J, status: number, statusText?: string): Response {
        const headers = { "Content-Type": "application/json" };

        //@ts-ignore
        if (jsObject[R._rev] || jsObject[R.rev]) {
            //@ts-ignore
            headers[R.ETag] = jsObject[R._rev] || jsObject[R.rev];
        }

        return new Response(JSON.stringify(jsObject),
            { headers: headers, status: status, statusText: statusText });
    }

    static dbFailedToInitialize(): Response {
        return new Response(JSON.stringify({ error: "Recliner not initialized" }), { headers: { "Content-Type": "application/json" }, status: 500 });
    }

    static sendOnlyStatus(status: number, statusText?: string, headers?: any): Response {
        const _headers = { ...headers };
        return new Response(null, { status, statusText, headers });
    }

    static toType(obj: any): "number" | "null" | "undefined" | "array" | "object" | "string" | "date" | "boolean" {
        //@ts-ignore
        return ({}).toString.call(obj).match(/\s([a-zA-Z]+)/)[1].toLowerCase()
    }

    /**
     * While calling only obj needs to be provided, rest all values are used by recursion.
     * @param selector which needs to be flattened 
     * @param result do not provide when calling this function outside recursion
     * @param ongoingkey do not provide when calling this function outside recursion
     * 
     * console.log(Utils.selectorFlatter({name:"User1",info:{age: {$gt: 30},isDev: true}}));
     * ```
     *  {
     *   "name":{$eq: "User1"},
     *   "info.age":{$gt : 30},
     *   "info.isDev": {$eq: true}
     *  }
     * ```
     * 
console.log(flatter({
    name:"User1",
    info:{
        age: {$gt: 30, help: {color: "red"}},
        isDev: true
    }
}))

```
 {
  name: { "$eq": "User1" },
  "info.age.$gt": { "$eq": 30 },
  "info.age.help.color": { "$eq": "red" },
  "info.isDev": { "$eq": true }
}
```
     * 
     */
    static selectorFlatter(selector:any, result:{[key:string]:FlattenObject}={}, ongoingkey:string=""):FlattenSelector{
        let t = Utils.toType(selector);
        switch(t){
           case "object":
                const keys=Object.keys(selector);
                if(keys.length==1){
                    const k = keys[0];
                    if(ConditionalOperators.has(k)){
                        //key is conditional operator
                        result[ongoingkey.substring(1)]=selector;
                        return selector;
                    }else{
                        Utils.selectorFlatter(selector[k],result,`${ongoingkey}.${k}`)
                    }
                }else{
                    for(let k in selector){
                        Utils.selectorFlatter(selector[k],result,`${ongoingkey}.${k}`);
                    }
                }
                break;
           default:
               result[ongoingkey.substring(1)]={$eq: selector};
               break;
        }
        return result;
    }

    /**
     * Only pass obj, do not pass other arguments, they are used by recursion.
     * @param obj 
     * @param result 
     * @param ongoingkey 
     */
    static flattenObjects(obj:any, result:{[key:string]:{[op:string]:any}}={}, ongoingkey:string=""):FlattenObject{
        let t = Utils.toType(obj);
        switch(t){
           case "object":
                for(let k in obj){
                    Utils.flattenObjects(obj[k],result,`${ongoingkey}.${k}`);
                }
                break;
           default:
               result[ongoingkey.substring(1)]=obj;
               break;
        }
        return result;
    }

    /**
     * * build_path("https://my.com/proxy/db","/some1/db?a=12") > "https://my.com/proxy/db/some1/db?a=12"
     * * build_path("https://my.com/proxy/db/","/some1/db?a=12") > "https://my.com/proxy/db/some1/db?a=12"
     * @param args 
     */
    static build_path(...args:string[]):string{
        return args.map((part, i) => {
          if (i === 0) {
            return part.trim().replace(/[\/]*$/g, '')
          } else {
            return part.trim().replace(/(^[\/]*|[\/]*$)/g, '')
          }
        }).filter(x=>x.length).join('/')
    }

    static combine_headers(...headers:HttpHeader[]):HttpHeader{
        return headers.reduce((p,c)=>{
            return {...p,...c};
        },{});
    }

    static blobToBase64(blob:Blob):Promise<string>{
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        return new Promise(resolve => {
            reader.onloadend = () => {
                let dataUrl = reader.result;
                //@ts-ignore
                const base64:string = dataUrl.split(',')[1];
                resolve(base64);
            };
        });
    }

    static checkIfPointInsidePolygon(point:number[],polygon:number[][]){ 
        let x = point[0], y = point[1];
        
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            let xi = polygon[i][0], yi = polygon[i][1];
            let xj = polygon[j][0], yj = polygon[j][1];
            
            let intersect = ((yi > y) != (yj > y))
                && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        
        return inside;
    }
}

