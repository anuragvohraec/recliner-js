import { DBDesignDoc, DBDoc, DBPutResponse, DBRunUpdateFunctionsRequest, ExecutionStats, MapReduceQuery, ReplicationInfoJSON } from "../../interfaces";
import { EncryptionEngine } from "../encryptionengine";

export interface ReclinerFindResult<T>{docs:T[],bookmark:string,execution_stats:ExecutionStats}


export class UsageDAO {

    static async getAttachmentBlob(dbname:string, docid:string,attachment_id:string):Promise<Blob|undefined>{
        const getAttachment = await fetch(`/recliner/${dbname}/${docid}/${attachment_id}?full=true`,{method: "GET"});
        if(getAttachment.status===200){
            let blob = await getAttachment.blob();
            return blob.slice(0, blob.size, getAttachment.headers.get("Content-Type"));
        }else{
            return;
        }
    }

    /**
     * 
     * @param dbname 
     * @param docid 
     * @returns undefined or found doc
     */
     static async checkAnAttachment(dbname:string, docid:string, attachment_id:string){
        const checkADoc = await fetch(`/recliner/${dbname}/${docid}/${attachment_id}`,{method: "HEAD"});
        if(checkADoc.status === 200){
            return true;
        }else{
            return false;
        }
    }

    /**
     * 
     * @param dbname 
     * @param docid 
     * @returns undefined or found doc
     */
     static async checkADoc(dbname:string, docid:string){
        const checkADoc = await fetch(`/recliner/${dbname}/${docid}`,{method: "HEAD"});
        if(checkADoc.status === 200){
            return true;
        }else{
            return false;
        }
    }
    
    /**
     * 
     * @param dbname 
     * @param docid 
     * @returns undefined or found doc
     */
    static async readADoc<T>(dbname:string, docid:string){
        const getADoc = await fetch(`/recliner/${dbname}/${docid}`);
        if(getADoc.status === 200){
            return (await getADoc.json()) as T;
        }else{
            return;
        }
    }

    static async readByPagination<T>(dbname:string,selector:any,sort:any, bookmark?:string):Promise<ReclinerFindResult<T>>{
        const readDocs = await fetch(`/recliner/${dbname}/_find`,{
            method: "POST",
            headers:{
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                selector,
                sort,
                bookmark
            })
        });
        if(readDocs.status === 200){
            return await readDocs.json();
        }else{
            console.log(readDocs.status, readDocs.statusText);
            
            return;
        }
    }

    static async postADoc<T extends DBDoc>(dbname:string, doc:T){
        if(!doc){
            return doc;
        }
        const saveMsgToDB = await fetch(`/recliner/${dbname}`,{
            method: "POST",
            headers:{
                "Content-Type": "application/json"
            },
            body: JSON.stringify(doc)
        });
        if(saveMsgToDB.status === 201){
            const r1 = await saveMsgToDB.json();
            doc._id=r1.id;
            doc._rev=r1.rev;
            return doc;
        }else{
            console.error("Error while saving doc to DB: ",saveMsgToDB.status, saveMsgToDB.statusText);
            return undefined;
        }
    }

    static async updateADoc<T extends DBDoc>(dbname:string, id:string,rev:string, doc:T){
        if(!doc){
            return doc;
        }else{
            const saveMsgToDB = await fetch(`/recliner/${dbname}/${id}?rev=${rev}`,{
                method: "PUT",
                headers:{
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(doc)
            });
            if(saveMsgToDB.status === 201){
                const r1 = await saveMsgToDB.json();
                doc._id=r1.id;
                doc._rev=r1.rev;
                return doc;
            }else{
                console.error("Error while updating a doc to DB: ",saveMsgToDB.status, saveMsgToDB.statusText);
                return undefined;
            }
        }
    }

    static async removeAttachmentFromExistingDoc(dbname:string,doc:{_id:string,_rev:string},attachment_name:string):Promise<{_id:string,_rev:string}>{
        let at = attachment_name.replace(/\?/g,"");
        if(at.trim().length===0){
            throw "Invalid attachment name";
        }
        const deleteAttachment = await fetch(`/recliner/${dbname}/${doc._id}/${at}?rev=${doc._rev}`,{method: "DELETE"}); 
        if(deleteAttachment.status===200){
            const r1 = await deleteAttachment.json();
            return {_id:r1.id,_rev:r1.rev};
        }else{
            return;
        }
    }

    /**
     * Adds attachment to existing doc. For non existing doc it will return false
     * @param dbname 
     * @param docid 
     * @param blobs 
     * @returns 
     */
    static async addAttachmentsToDocID(dbname:string,docid:string, attachmentMap: Record<string,Blob>):Promise<boolean>{
        let getDoc = await this.readADoc(dbname,docid);
        if(!getDoc){
            return false;
        }else{
            let {_id,_rev}=getDoc as {_id:string,_rev:string};
            for(let attachment of Object.keys(attachmentMap)){
                const addAttachment = await fetch(`/recliner/${dbname}/${_id}/${attachment}?rev=${_rev}`,{
                    method: "PUT",
                    headers: {
                        "Content-Type":attachmentMap[attachment].type,
                    },
                    body: attachmentMap[attachment]
                });
                if(addAttachment.status===201){
                    let t = await addAttachment.json();
                    _id=t.id;
                    _rev=t.rev;
                    continue;
                }else{
                    return false;
                }
            }
        }

        return true;
    }

    static async addAnAttachmentToExistingDoc<T extends DBDoc>(dbname:string,doc:T, attachment_name:string, blob:Blob,new_edits:boolean=true,cloud_url?:string,content_type?:string){
        let at = attachment_name.replace(/\?/g,"");
        if(at.trim().length===0){
            throw "Invalid attachment name";
        }
        let ct = blob.type;
        if(!ct || ct.length===0){
            ct = content_type??"application/octet-stream";
        }
        const addAttachment = await fetch(`/recliner/${dbname}/${doc._id}/${at}?rev=${doc._rev}${new_edits?"":"&new_edits=false"}`,{
            method: "PUT",
            headers: {
                "Content-Type":ct,
                "cloud_url":cloud_url
            },
            body: blob
        });
        if(addAttachment.status===201){
            const r1 = await addAttachment.json();
            doc._id=r1.id;
            doc._rev=r1.rev;
            return doc;
        }else{
            console.error("Unable to save attachment: ",addAttachment.status, addAttachment.statusText);
            return;
        }
    }
    
    static async checkAndCreateDB(dbname:string, createDBIfNotExist:boolean=true):Promise<boolean>{
        const checkDB = await fetch(`/recliner/${dbname}`,{
            method: "HEAD",
        });
        if(checkDB.status===404){
            if(createDBIfNotExist){
                //lets create DB
                const createDB = await fetch(`/recliner/${dbname}`,{
                    method:"PUT"
                });
                if(createDB.status === 201){
                    return true;
                }else{
                    console.error(`Create DB failed: ${dbname}`, createDB.statusText, createDB.status);
                    return false;
                }
            }else{
                return false;
            }
        }else if(checkDB.status===200){
            return true;
        }else{
            console.error(`Failed to check DB: ${dbname}`, checkDB.statusText, checkDB.status);
            return false;
        }
    }

    /**
     * ```
(async(data)=>{
const res = await fetch("/recliner/user/_index",
{method: "POST", headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});

console.log("Create index",await res.text(), res.status, "ETag: ", res.headers.get("ETag"))
})({name: "bynameindex", ddoc:"bynamedes", index:{
    fields: ["name"],
    sort: [{name: "desc"}]
}})
```
     */
    static async checkAndCreateIndex(dbname:string,ddocname:string, indexname:string,fields:string[], sort?:Record<string,"asc"|"desc">[]){
        if(!sort){
            sort = fields.map(e=>{
                let t:any={};
                t[e]="asc";
                return t;
            });
        }
        const r1 = await fetch(`/recliner/${dbname}/_design/${ddocname}`,{
            method: "HEAD"
        });
        if(r1.status !=200){
            const res = await fetch(`/recliner/${dbname}/_index`,
            {method: "POST", headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
                name: indexname,
                ddoc: ddocname,
                index:{
                    fields
                }
            })});
            if(res.status === 201){
                return true;
            }else{
                console.error("Cannot create design: ",dbname,ddocname,res.status,res.statusText);
                
                return false;
            }
        }else{
            return true;
        }
    }


     /**
     * 
     * @param dbname 
     * @param docid 
     * @returns undefined or found doc
     */
      static async readALocalDoc<T>(dbname: string, docid: string) {
        const getADoc = await fetch(`/recliner/${dbname}/_local/${docid}`);
        if (getADoc.status === 200) {
            return (await getADoc.json()) as T;
        } else {
            return;
        }
    }

    /**
     * Put A local doc to database
     * @param dbname 
     * @param doc 
     * @returns 
     */
    static async putALocalDoc(dbname:string,doc: any):Promise<boolean>{
        if(doc._id){
            const res = await fetch(`/recliner/${dbname}/_local/${doc._id}`,
            {method: "PUT",headers: {'Content-Type': 'application/json'}, body: JSON.stringify(doc)});
            if(res.status===200){
                return true;
            }else{
                console.error(res.status,res.statusText, await res.text());
                return false;
            }
        }else{
            throw `A Local doc cannot be saved without having an _id property`;
        }
    }

    /**
     * Checks a local doc and return true or false
     * @param dbname 
     * @param docid 
     * @returns 
     */
    static async checkALocalDoc(dbname:string, docid:string):Promise<boolean>{
        const res = await fetch(`/recliner/${dbname}/_local/${docid}`,{method: "HEAD"});
        if(res.status === 200){
            return true;
        }else{
            return false;
        }
    }

    static async findByPagination<T>(info:{
        dbname:string,selector:any,sort?:any, bookmark?:string,limit?:number
        fields?:string[]
    }):Promise<ReclinerFindResult<T>>{
        const readDocs = await fetch(`/recliner/${info.dbname}/_find`,{
            method: "POST",
            headers:{
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                selector: info.selector,
                sort: info.sort,
                bookmark: info.bookmark,
                limit: info.limit??-1,
                fields: info.fields
            })
        });
        if(readDocs.status === 200){
            return await readDocs.json();
        }else{
            console.log(readDocs.status, readDocs.statusText);
            
            return;
        }
    }

    static async removeADoc(dbname:string, docid:string, rev:string){
        let removeDoc = await fetch(`/recliner/${dbname}/${docid}?rev=${rev}`,{
            method: "DELETE"
        });

        if(removeDoc.status === 200){
            return true;
        }else{
            console.log(removeDoc.status,removeDoc.statusText,await removeDoc.text());
            return false;
        }
    }

    static async replicate(replicationInfo:ReplicationInfoJSON){
        const res = await fetch("/recliner/_replicate",
        {method: "POST",headers: {'Content-Type': 'application/json'}, body: JSON.stringify(replicationInfo)});
        if(res.status === 200){
            return true;
        }else{
            return false;
        }
    }

    static async putADBDesign(dbname:string,dbDesignDoc: DBDesignDoc){
        const res = await fetch(`/recliner/${dbname}/_db_design`,{
            method:"PUT",
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(dbDesignDoc)
        });
        if(res.status!==201){
            console.error("Failed to create DB Design doc.", res.status, res.statusText);
            return false;
        }else{
            return true;
        }
    }

    static async postQueryToDBDesign<D>(dbname:string, query:MapReduceQuery):Promise<{docs:D[]}>{
        const res = await fetch(`/recliner/${dbname}/_db_design`,{
            method:"POST",
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(query)
        });
        if(res.status!==200){
            console.error("Failed to query DB Design doc.", res.status, res.statusText);
            return;
        }else{
            return await res.json() as {docs:D[]};
        }
    }

    static async makeLocalChangesToExistingADoc(dbname:string,doc:Record<string,any>){
        const res = await fetch(`/recliner/${dbname}/${doc._id}?new_edits=false`,{
            method:"PUT",
            headers:{
                "Content-Type":"application/json"
            },
            body:JSON.stringify(doc)
        });
        if(res.status === 200){return true;}else{
            return false;
        }
    }

    static async checkAttachment(dbname:string,docid:string,attachment_name:string, physical:boolean=false):Promise<boolean>{
        let url = `/recliner/${dbname}/${docid}/${attachment_name}?${physical?"physical=true":""}`;
        const res = await fetch(url,{method:"HEAD"});
        if(res.status === 200){
            return true;
        }else{
            return false;
        }
    }

    static async deleteADoc(dbname:string, docid:string, keep_field?:string){
        let findDoc = await fetch(`/recliner/${dbname}/${docid}`,{
            method: "HEAD"
        });
        if(findDoc.status ===200){
            let rev = findDoc.headers.get("ETag");

            let headers:any={};
            if(keep_field){
                headers={keep_field}
            }

            let removeDoc = await fetch(`/recliner/${dbname}/${docid}?rev=${rev}`,{
                method: "DELETE",
                headers
            });

            if(removeDoc.status === 200){
                return true;
            }else{
                console.log(removeDoc.status,removeDoc.statusText,await removeDoc.text());
                return false;
            }
        }else{
            return false;
        }
    }

/**
    * 
    * @param dbname 
    * @param docid 
    * @param updateDocFunction 
    * if returns a undefined value it will be created or updated in database.
    * If an undefined is returned nothing is done.
    * old doc can be undefined in case of no such doc exist
    * @param makeLocalChanges  if true no rev will be updated after updating an existing doc
    * @returns 
*/
    static async updateOrCreate<D extends DBDoc>(dbname:string,docid:string,updateDocFunction:(oldDoc:D)=>Promise<D>,makeLocalChanges:boolean=false):Promise<boolean>{
        //lets check if doc exist
        let getDoc = docid?await fetch(`/recliner/${dbname}/${docid}`,{
            headers: {"Content-Type":"application/json"},
            method: "GET"
        }):{status:404,json:()=>"dummy"};

        let oldDoc:D;
        let url:string;
        let newDoc:D;

        
        if(getDoc.status === 404){
            if(!docid){
                docid = await EncryptionEngine.uuid();
            }
            //doc do not exist
            url = `/recliner/${dbname}/${docid}`;    
        }else if(getDoc.status === 200){
            //doc exist
            oldDoc = await getDoc.json();
            url = `/recliner/${dbname}/${docid}?rev=${oldDoc._rev}`;
            if(makeLocalChanges){
                url+="&new_edits=false";
            }
        }else{
            return false;
        }
        
        newDoc = await updateDocFunction(oldDoc);
        if(!newDoc){
            return false;
        }


        let updateDoc =  await fetch(url,{
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify(newDoc),
            method:"PUT"
        });
        return updateDoc.status === 201 ? true:false;
    }


    /**
     * Deletes all database managed by recliner, except for system db. It clears of _system object stores.
     * So that recliner can keep functioning
     */
    static async RECLINER_DELETE():Promise<boolean>{
        let delRecliner = await fetch(`/recliner/_delete_recliner`,{
            method: "DELETE"
        });
        if(delRecliner.status === 201){
            return true;
        }else{
            console.error(delRecliner.status,delRecliner.statusText);
            return false;
        }
    }


    static async run_update_functions(dbname:string,runUpdateFunctionsRequest: DBRunUpdateFunctionsRequest, new_edits:boolean=true):Promise<DBPutResponse>{
        let res = await fetch(`/recliner/${dbname}/_run_update_function${new_edits?"":"?new_edits=false"}`,{
            method:"PUT",
            body: JSON.stringify(runUpdateFunctionsRequest)
        });
        if(res.status === 201){
            return await res.json();
        }else{
            console.error(res.status, res.statusText, await res.text);
        }
    }

    /**
     * find one element by selector
     * @param param0 
     * @returns 
     */
    static async findOne<T>({dbname,selector}:{dbname:string,selector:any}){
        const t = await this.findByPagination<T>({
            dbname,
            selector,
            limit:1
        });
        return t.docs[0];
    }

    /**
     * delete docs by selector
     * @param param0 
     * @returns deleted docs
     */
    static async deleteBySelector<T>({dbname,selector}:{dbname:string,selector:any}){
        const foundDocs = await this.findByPagination<T>({
            dbname,selector
        });
        for(let d of foundDocs.docs){
            //@ts-ignore
            await this.deleteADoc(dbname,d._id);
        }
        return foundDocs.docs;
    }
}