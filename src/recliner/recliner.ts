import { PathDirection } from "./engines/compass";
import {DBDetails, Design , FindResult} from './engines/dao/dao';
import { EncryptionEngine } from "./engines/encryptionengine";
import { URIEngine, Action} from "./engines/uriengine";
import { FlattenObject, Utils} from "./utils";
import {ChangeDoc, ChangeReqJson, ReplicationInfoJSON, ReplicationResponseJSON, RepLogs, RepLogsHistory, RevDiffReq, RevDiffRes, Selector, HttpHeader, BulkDocRequestBody, DBPutResponse, DBDesign, DBDocValidationFunction, DBDesignDoc, MapReduceQuery, CollectFunction, ReduceFunction, MapFunction, DBRunUpdateFunctionsRequest, DBDocUpdateFunction, DBDoc, DBDocAttachmentInfo, MVCC, PageData, ViewRow, ViewResultFilterFunction,RenderFunction,RecQuery,Sort} from './interfaces';
import { ReclinerDAO } from "./engines/dao/reclinerdao";

const _recliner_version =1;
const _replication_version=3;

interface ID_REV{
 id: string;
 rev:string;
}

/**
 * Keys will be DBName and value will be the dao
 */
export interface DBDAOMap{
    [dbname:string]:ReclinerDAO
}

interface CREATE_INDEX_BODY{
    index: {fields: string[],sort?: {[key:string]:"asc"|"desc"}[]};
    ddoc: string;
    name: string
}


/**
 * Do not change content of this class , all are constants used throughout recliner
 */
 export class R{
    static readonly _system="_system";
    static readonly _db_info = "_db_info";
    static readonly _db_design ="_db_design";
    static readonly for_db="for_db";
    static readonly _id = "_id";
    static readonly _rev="_rev";
    static readonly id ="id";
    static readonly rev = "rev";
    static readonly ETag="ETag";
    static readonly _deleted="_deleted";
    static readonly deleted = "deleted";
    static readonly _changes="_changes";
    static readonly seq="seq";
    static readonly _design="_design";
    static readonly _attachments="_attachments";
    static readonly cloud_attachments="cloud_attachments";
    static readonly recliner_attachment_key="rak";
    static readonly cloud_url="cloud_url";
    static readonly get_fresh_copy_from_lazy_link="get_fresh_copy_from_lazy_link";
    static readonly _selector="_selector";
    static readonly _doc_ids="_doc_ids";
    static readonly _local="_local";
    static readonly max_rep_logs_history=100;
    static readonly _mvcc="_mvcc";
    /**
     * key is hash of cloud url, range and buffer size, value is Blob
     */
    static readonly _partial_contents="_partial_contents";
    /**
     * Used as a header. This is used while fetching attachments. Attachments are some time lazy loaded from cloud URL. Now a cloud URL may contain a very big data.
     * downloading it at user machine may be a problem. So this can be used to deny any cloud URL download if its content size is bigger than this.
     */
    static readonly max_cloud_content_length="max_cloud_content_length";
}

const BASIC_DB_STRUCTURE: DBDetails[] = [{name: R._id, primaryKeyName: R._id},{name: R._attachments},{name:R._partial_contents},{name:R._changes, primaryKeyName: R._id},{name:R._local,primaryKeyName:"_id"},{name:R._design,primaryKeyName:R._id},{name:R._mvcc,primaryKeyName:R._id}];

const SYSTEM_DB ="_system";


enum ReplicationCase{
    LocalToLocal,
    LocalToRemote,
    RemoteToLocal,
    UnsupportedCase
}


export class Recliner{
    
    private uriEngine: URIEngine;
    public isInitialized: Promise<boolean>;
    private dbdaomap: DBDAOMap={};
    private _system_db_dao: ReclinerDAO;
    private _db_design_map:Record<string,DBDesign>={};

    /**
     * 
     * @param replication_bulk_doc_limit 
     * @param partialContentConfig key is content type(mime) and value is buffer size
     */
    constructor(private replication_bulk_doc_limit:number=25, private partialContentConfig:Record<string,number>={}){
        this.uriEngine = new URIEngine();
        this.isInitialized = this._init();
    }

    
    public static get version() : number {
        return _recliner_version;
    }
    
    
    async _init():Promise<boolean>{
        try{
            /**
             * Setting up system db: System db stores info about other databases
             */
            this._system_db_dao = new ReclinerDAO(SYSTEM_DB,1,[{name: R._db_info,primaryKeyName: R._id},{name:R._db_design,primaryKeyName:R.for_db}]);
            if(!await this._system_db_dao.isInitialized){
                throw `DB ReclinerDAO failed to initialize for db: ${SYSTEM_DB}`;
            }
            this.dbdaomap[SYSTEM_DB]=this._system_db_dao;

            //get DBs from system DB and populate the dbdaomap
            let t1  = await this._system_db_dao.read(R._db_info);
            if(t1){
                for(let i = 0; i<t1.length; i++){
                    let e : { _id: string; version: number; listofDBDetails: DBDetails[]; }= t1[i];
                    await this._get_db_dao(e._id, e.version, e.listofDBDetails);
                }
            }

            //lets initialize db designs
            let dbDesignsList:DBDesignDoc[] = await this._system_db_dao.read(R._db_design);
            if(dbDesignsList && dbDesignsList.length>0){
                for(let dbDesignDoc of dbDesignsList){
                    let dbDesign:DBDesign=this.convertDbDesignDocToDbDesign(dbDesignDoc);
                    this._db_design_map[dbDesignDoc.for_db.toLowerCase()]=dbDesign;
                }
            }

            // console.log(`Recliner V${Recliner. version} initialized.`);
            // console.log(`${Object.keys(this.dbdaomap)}`);
            
            return true;
        }catch(e){
            console.error(`Recliner V${Recliner. version} failed to initialize.`);
            console.error(e);
            return false;
        }
    }

    static getPathFromUrl(req: Request): string{
        const url_path = new URL(req.url).pathname;
        return url_path;
    }

    async process(req: Request): Promise<Response>{
        if(await this.isInitialized){
            const url_path = Recliner.getPathFromUrl(req);
            const {action, direction} = this.uriEngine.identifyTheAction(url_path,req.method);
            switch (action) {
                case Action.RECLINER_DELETE: return await this.RECLINER_DELETE(direction,req);
                case Action.GET_DBMS_INFO: return this.GET_DBMS_INFO();
                case Action.CHECK_DB_EXISTENCE: return this.CHECK_DB_EXISTENCE(direction);
                case Action.GET_INFO_ABT_A_DB: return this.GET_INFO_ABT_A_DB(direction);
                case Action.PUT_A_NEW_DB: return await this.PUT_A_NEW_DB(direction);
                case Action.DELETE_THE_DB: return await this.DELETE_THE_DB(direction);
                case Action.POST_A_NEW_DOC: return await this.POST_A_NEW_DOC(direction, req);
                case Action.CHECK_DOC_EXISTENCE: return await this.CHECK_DOC_EXISTENCE(direction);
                case Action.GET_THE_DOCUMENT: return await this.GET_THE_DOCUMENT(direction);
                case Action.PUT_A_DOC: return await this.PUT_A_DOC(direction, req);
                case Action.DELETE_THE_DOC: return await this.DELETE_THE_DOC(direction, req);
                case Action.CHECK_DESIGN_DOC_EXISTENCE: return await this.CHECK_DESIGN_DOC_EXISTENCE(direction);
                case Action.GET_THE_DESIGN_DOC: break;
                case Action.PUT_A_DESIGN_DOC: return await this.PUT_A_DESIGN_DOC(direction, req);
                case Action.DELETE_A_DESIGN_DOC: break;
                case Action.GET_THE_RESULT_OF_VIEW: break;
                case Action.POST_A_VIEW_QUERY: break;
                case Action.CHECK_ATTACHMENT_EXISTENCE: return await this.CHECK_ATTACHMENT_EXISTENCE(direction,req);
                case Action.GET_ATTACHMENT_FOR_THE_DOC: return await this.GET_ATTACHMENT_FOR_THE_DOC(direction,req);
                case Action.PUT_AN_ATTACHMENT_TO_THE_DOC: return await this.PUT_AN_ATTACHMENT_TO_THE_DOC(direction,req);
                case Action.DELETE_THE_ATTACHMENT_OF_THE_DOC: return await this.DELETE_THE_ATTACHMENT_OF_THE_DOC(direction,req);
                case Action.REPLICATE: return await this.REPLICATE(req);
                case Action.GET_CHANGE_FEED: break;
                case Action.POST_CHANGE_FEED: break;
                case Action.POST_REVS_DIFF: break;
                case Action.CASE_DO_NOT_EXIST: break;
                case Action.CREATE_INDEX: return await this.CREATE_INDEX(direction,req);
                case Action.DELETE_INDEX: break;
                case Action.CHECK_INDEX: break;
                case Action.FIND_IN_INDEX: return await this.FIND_IN_INDEX(direction,req);
                case Action.BULK_GET: break;
                case Action.CHECK_LOCAL_DOC: return await this.CHECK_LOCAL_DOC(direction);
                case Action.GET_LOCAL_DOC: return await this.GET_LOCAL_DOC(direction);
                case Action.PUT_A_LOCAL_DOC: return await this.PUT_A_LOCAL_DOC(direction,req);
                case Action.DELETE_A_LOCAL_DOC: return await this.DELETE_A_LOCAL_DOC(direction);
                case Action.PUT_DB_DESIGN: return await this.PUT_DB_DESIGN(direction,req);
                case Action.QUERY_DB_DESIGN: return await this.QUERY_DB_DESIGN(direction,req);
                case Action.CHECK_DB_DESIGN: return await this.CHECK_DB_DESIGN(direction);
                case Action.RUN_UPDATE_FUNCTIONS: return await this.RUN_UPDATE_FUNCTIONS(direction,req);
                case Action.SINGLE_TX_PUT: return await this.SINGLE_TX_PUT(direction, req);
                default: break;
            }
            return Utils.sendJsonResponse({error: "No action defined for it"},404);
        }else{
            console.error("Recliner failed to initialize");
            return Utils.dbFailedToInitialize();
        }
        
    }

    private async RECLINER_DELETE(direction: PathDirection, req:Request):Promise<Response>{
        try{
            for(let dbName in this.dbdaomap){
                if(dbName!==R._system){
                    await this.dbdaomap[dbName].deleteTheDB();
                    delete this.dbdaomap[dbName];
                    delete this._db_design_map[dbName];
                }
            }
            if(await this.dbdaomap[R._system].cleanAllObjectStores()){
                return Utils.sendOnlyStatus(201);
            }else{
                return Utils.sendOnlyStatus(500,`_system db can't be cleaned`);
            }
            
        }catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,`Unknown error ${e.message??e}`);
        }
    }

    private async CHECK_DB_DESIGN(direction: PathDirection):Promise<Response>{
        //check if db exist
        const dbname = direction.path_params["db"].toLocaleLowerCase();

        const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
        if(foundNoDB){
            return foundNoDB;
        }

        if(!this._db_design_map[dbname]){
            return Utils.sendOnlyStatus(404);
        }else{
            return Utils.sendOnlyStatus(200);
        }
    }

    private async PUT_DB_DESIGN(direction: PathDirection, req: Request):Promise<Response>{
        try{
            //check if db exist
            const dbname = direction.path_params["db"].toLocaleLowerCase();
            
            if(dbname === SYSTEM_DB.toLowerCase()){
                return Utils.sendOnlyStatus(400,"You cannot create designs for system db");
            }

            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }
            
            //create DBDesign Object from doc supplied If its created then all good, else send error
            let dbDesignDoc:DBDesignDoc = await req.json();
            
            let dbDesign:DBDesign=this.convertDbDesignDocToDbDesign(dbDesignDoc);
            
            //create/update design in systemdb._db_design
            let overwriteDesignDocInSystemDB = await this.dbdaomap[SYSTEM_DB].update(R._db_design,dbname,(oldDoc:DBDesignDoc)=>{
                return dbDesignDoc;
            },dbDesignDoc);

            if(overwriteDesignDocInSystemDB){
                //load DBDesign object in _db_design_map
                this._db_design_map[dbname]=dbDesign;

                //send response all good
                return Utils.sendOnlyStatus(201);
            }else{
                return Utils.sendOnlyStatus(500,"DB Design not overwritten in systemDB._db_design");
            }
        }catch(e){
            console.error(e);
            return Utils.sendJsonResponse({
                ok: false
            },500, e.message);
        }
    }

    private convertDbDesignDocToDbDesign(dbDesignDoc:DBDesignDoc):DBDesign{
        let dbDesign:DBDesign={};
        if(dbDesignDoc.doc_validation_function){
            let t = new Function("return "+dbDesignDoc.doc_validation_function);
            let f:DBDocValidationFunction = t();
            dbDesign.doc_validation_function=f;
        }

        if(dbDesignDoc.map_functions){
            dbDesign.map_functions={};

            for(let name of Object.keys(dbDesignDoc.map_functions)){
                if(!name.startsWith("m_")){
                    throw "Map function should start with m_";
                }
                let t = new Function("return "+dbDesignDoc.map_functions[name]);
                let f:MapFunction = t();
                dbDesign.map_functions[name]=f;
            }
            
        }

        if(dbDesignDoc.reduce_functions){
            dbDesign.reduce_functions={};

            for(let name of Object.keys(dbDesignDoc.reduce_functions)){
                if(!name.startsWith("r_")){
                    throw "Reduce function should start with r_";
                }
                let t = new Function("return "+dbDesignDoc.reduce_functions[name]);
                let f:ReduceFunction = t();
                dbDesign.reduce_functions[name]=f;
            }
        }

        if(dbDesignDoc.update_functions){
            dbDesign.update_functions={};
            for(let name of Object.keys(dbDesignDoc.update_functions)){
                if(!name.startsWith("u_")){
                    throw "Update function should start with u_";
                }
                let t = new Function("return "+dbDesignDoc.update_functions[name]);
                let f:DBDocUpdateFunction = t();
                dbDesign.update_functions[name]=f;
            }
        }

        if(dbDesignDoc.view_result_filter_functions){
            dbDesign.view_result_filter_functions={};
            for(let name of Object.keys(dbDesignDoc.view_result_filter_functions)){
                if(!name.startsWith("v_")){
                    throw "View filter function should start with v_";
                }
                let t = new Function("return "+dbDesignDoc.update_functions[name]);
                let f:ViewResultFilterFunction = t();
                dbDesign.view_result_filter_functions[name]=f;
            }
        }

        if(dbDesignDoc.render_functions){
            dbDesign.render_functions={};
            for(let name of Object.keys(dbDesignDoc.render_functions)){
                if(!name.startsWith("rn_")){
                    throw "Render function should start with rn_";
                }
                let t = new Function("return "+dbDesignDoc.render_functions[name]);
                let f:RenderFunction = t();
                dbDesign.render_functions[name]=f;
            }
        }

        return dbDesign;
    }

    private async RUN_UPDATE_FUNCTIONS(direction: PathDirection, req: Request):Promise<Response>{
        try{ 
            //TODO
            //check if db exist
            const dbname = direction.path_params["db"].toLocaleLowerCase();
            
            //user is not allowed to update system db
            if(dbname === SYSTEM_DB.toLowerCase()){
                return Utils.sendOnlyStatus(404,"You cannot update system db");
            }

            //lets check if DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }

            const updateReq:DBRunUpdateFunctionsRequest = await req.json();
            const dbDesign:DBDesign = this._db_design_map[dbname];
            if(!dbDesign){
                return Utils.sendOnlyStatus(404,"No DB Design doc found");
            }

            //lets check if update function exist
            for(let t of updateReq.update_function_names){
                if(t.startsWith("u_")){
                    if(dbDesign.update_functions[t]){
                        continue;
                    }else{
                        return Utils.sendOnlyStatus(404,`No such update function ${t} in db ${dbname} design`);
                    }
                }else{
                    return Utils.sendOnlyStatus(404,`u_ convention violated: ${t}`);
                }
            }

            let selectorResult = await this.dbdaomap[dbname].find({dbname:R._id,selector: updateReq.selector});
            let docs=selectorResult.docs;


            for(let t of updateReq.update_function_names){
                docs=await dbDesign.update_functions[t]({recliner:this,direction,req},docs,updateReq.valueForModification);
            }

            const url =  new URL(req.url);
            const ne = url.searchParams.get("new_edits");
            let new_edits=true;
            if(ne){
                new_edits=ne==="false"?false:true;
            }

            const response:DBPutResponse[]=[];

            for(let doc of docs){
                if(new_edits){
                    //new_edits false happens only when user knows what they are doing, say by replication scenario.
                    //and can be allowed to override something
                    const dbDesign:DBDesign = this._db_design_map[dbname];
                    if(dbDesign && dbDesign.doc_validation_function){
                        let valMessage = await dbDesign.doc_validation_function({recliner:this,direction,req},doc,"update");
                        if(valMessage){
                            response.push({
                                id: doc._id,
                                rev: doc._rev,
                                ok:false,
                                error: "Validation Failed",
                                reason:valMessage
                            });
                            continue;
                        }
                    }
                }

                response.push(await this._update_a_doc(dbname,doc,new_edits));
            }

            return Utils.sendJsonResponse({docs:response},201);
        }catch(e){
            console.error(e);
            return Utils.sendJsonResponse({
                ok: false
            },500, e.message);
        }
    }

    private async QUERY_DB_DESIGN(direction: PathDirection, req: Request):Promise<Response>{
        try{
            //check if db exist
            const dbname = direction.path_params["db"].toLocaleLowerCase();
            
            //user is not allowed to query system db
            if(dbname === SYSTEM_DB.toLowerCase()){
                return Utils.sendOnlyStatus(404,"You cannot query system db");
            }

            //lets check if DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }

            //check query send by user
            const query:MapReduceQuery = await req.json();
            const dbDesign:DBDesign = this._db_design_map[dbname];
            if(!dbDesign){
                return Utils.sendOnlyStatus(404,"No DB Design doc found");
            }
            //lets check if map reduce function exist
            for(let t of query.map_reduce_queue){
                if(t.startsWith("m_") && dbDesign.map_functions[t]){
                    continue;
                }else if(t.startsWith("r_") && dbDesign.reduce_functions[t]){
                    continue;
                }else{
                    return Utils.sendOnlyStatus(404,`m_ and r_ convention violated: ${t}`);
                }
            }

            //lets query database
            let selectorResult = await this.dbdaomap[dbname].find({dbname:R._id,selector: query.selector, fields: query.fields});
            //there canbe queries which can emit result even when docs are zero size
            // if(selectorResult.docs.length===0){
            //     return Utils.sendJsonResponse({docs:[]},200);
            // }

            let docs=selectorResult.docs;

            //lets apply map reduce now
            for(let t of query.map_reduce_queue){
                if(t.startsWith("m_")){
                    //case of mapping
                    let mapped_docs:any[]=[];
                    let collect:CollectFunction=(value:any)=>{
                        mapped_docs.push(value)
                    }
                    for(let doc of docs){
                        let mf = dbDesign.map_functions[t];
                        await mf({recliner:this,direction,req},collect,doc,query.data);
                    }
                    docs=mapped_docs;
                }else{
                    //case of reduce
                    let reduced_docs:any[]=[];
                    let collect:CollectFunction=(value:any)=>{
                        reduced_docs.push(value)
                    }
                    let rf = dbDesign.reduce_functions[t];
                    await rf({recliner:this,direction,req},collect,docs,query.data);
                    docs=reduced_docs;
                }
            }

            return Utils.sendJsonResponse({docs},200);
        }catch(e){
            console.error(e);
            return Utils.sendJsonResponse({
                ok: false
            },500, e.message);
        }
    }

    private async _update_db_info_in_system_DB(dbname: string,version:number,listofDBDetails: DBDetails[]){
        let t1  = await this.dbdaomap[SYSTEM_DB].read(R._db_info,dbname);
        if(!t1){
            //create a record.
            return await this.dbdaomap[SYSTEM_DB].create(R._db_info,{_id: dbname, version, listofDBDetails});
        }else{
            //update the record.
            await this.dbdaomap[SYSTEM_DB].update(R._db_info,dbname,async (doc)=>{
                if(doc.version!==version){
                    let t1 ={...doc,...{version:version,listofDBDetails:listofDBDetails}}
                    return t1;
                }
            });
            return true;
        }
    }


    private async _get_db_dao(dbname: string, version:number=1,listofDBDetails: DBDetails[]=BASIC_DB_STRUCTURE, doSystemDBUpdate:boolean=true): Promise<ReclinerDAO>{
        if(!this.dbdaomap[dbname] || this.dbdaomap[dbname].version !== version){
            let designs:Design[]|undefined;
            if(this.dbdaomap[dbname]){
                designs = await this.dbdaomap[dbname].read(R._design);
                this.dbdaomap[dbname].closeTheDB();
            }
            this.dbdaomap[dbname]= new ReclinerDAO(dbname,version,listofDBDetails, designs);
            //make an entry in system db
            if(doSystemDBUpdate){
                if(!await this._update_db_info_in_system_DB(dbname,version,listofDBDetails)){
                    throw `Failed to update systemdb._db_info for DB ${dbname}`;
                }
            }
        }
        if(!await this.dbdaomap[dbname].isInitialized){
            throw `DB ReclinerDAO failed to initialize for db: ${dbname}`;
        }else{
            return this.dbdaomap[dbname];
        }
    }
    
    private async GET_DBMS_INFO(){
        let r :any= {
            recliner: "Welcome",
            version: `${Recliner.version}`,
            vendor: {
              name: "yelo.ws"
            }
        }
        const uuid = await EncryptionEngine.sha1_hash(JSON.stringify(r));
        r["uuid"]=uuid;
        return Utils.sendJsonResponse(r, 200)
    }

    private async PUT_A_NEW_DB(direction: PathDirection){
        const dbname = direction.path_params["db"];
        if(this.dbdaomap[dbname]){
            return Utils.sendJsonResponse({ok:false},412);
        }else{
            if(await this._get_db_dao(dbname,1,BASIC_DB_STRUCTURE)){
                return Utils.sendJsonResponse({ok:true}, 201);
            }else{
                return Utils.sendJsonResponse({ok:false}, 500);
            }
        }
    }

    private async DELETE_THE_DB(direction:PathDirection){
        const dbname = direction.path_params["db"];
        if(this.dbdaomap[dbname]){
            //delete the db
            if(await this.dbdaomap[dbname].deleteTheDB() && await this._system_db_dao.delete(R._db_info,dbname) && delete this.dbdaomap[dbname]){
                return Utils.sendJsonResponse({ok:true},200);
            }else{
                return Utils.sendJsonResponse({ok:false},500);
            }
            
        }else{
            return Utils.sendJsonResponse({ok:false},404);
        }
    }

    private async CHECK_DB_EXISTENCE(direction:PathDirection){
        const dbname = direction.path_params["db"];
       
        const doDbExist: boolean = await ReclinerDAO.checkIfDBExist(dbname);
        if(doDbExist){
            return Utils.sendOnlyStatus(200);
        }else{
            return Utils.sendOnlyStatus(404);
        }
    }

    private async GET_INFO_ABT_A_DB(direction:PathDirection){
        const dbname = direction.path_params["db"];
        const checkDb = await this.CHECK_DB_EXISTENCE(direction);
        if(checkDb.status === 404){//not found
            return checkDb;
        }else{
            let update_seq=await this.getDBUpdateSeq(dbname);

            return Utils.sendJsonResponse({
                db_name: dbname,
                update_seq
            },200);
        }
    }

    private async getDBUpdateSeq(dbname:string):Promise<string>{
        let update_seq="0";
        const lastObject = await this.dbdaomap[dbname].getLastObjectFromObjectStore(R._changes);
        if(lastObject){
            update_seq = lastObject[R.seq];
        }
        return update_seq;
    }

    private async getRemoteDBUpdateSeq(sourceurl:string,headers:HttpHeader):Promise<string>{
        const d = await fetch(
            sourceurl,
            {
                method:"GET",
                headers:Utils.combine_headers(headers,{"Content-Type":"application/json"}),
            }
        )
        if(d.status!==200){
            console.log(d.status,d.statusText, await d.text());
            
            throw `Cannot reach remote db: ${sourceurl}`;
        }else{
            const t = await d.json();
            return t["update_seq"];
        }
    }

    /**
     * Adds _id  if not present, add/update _rev.
     * Updated new rev on the doc too.
     * @param doc 
     */
    private async makeDocReadyForUpdates(dbname:string, doc: FlattenObject,new_edits:boolean=true):Promise<ID_REV>{
        if(new_edits){
            if(!doc[R._id]){
                doc[R._id]=await EncryptionEngine.random_id();
            }
    
            const old_rev:string = doc[R._rev];
            let new_rev:string;
            if(!old_rev){
                new_rev = `1-${await EncryptionEngine.sha1_hash(JSON.stringify(doc))}`
            }else{
                const t = old_rev.split("-");
                let n = parseInt(t[0]);
                n++;
                delete doc[R._rev];
                new_rev = `${n}-${await EncryptionEngine.sha1_hash(JSON.stringify(doc))}`
            }
            doc[R._rev]=new_rev;
        }

        //MVCC: Solution, its needed to have proper MVCC branches at both system.
        /**
        {
            "_id" : "5ebe99c6b179d0be4ff05bd43d0038d1",
            "_revisions" : {
            "start" : 2,
            "ids" : [ "7a5de99d17a4504b2f74cda829bf7054", "0c4f4e08acc7931c290193b1434f5e2b" ]
            }
        }
        */
        //1. lets get the existing MVCC entry
        let mvcc_doc:{_id:string,_revisions:MVCC}=await this.dbdaomap[dbname].read(R._mvcc,doc[R._id]);
        
        //2. update it
        if(!mvcc_doc){
            mvcc_doc={_id:doc[R._id],_revisions:{start:0,ids:[]}}
        }
        let rev = doc[R._rev];
        let r = rev.split("-");
        mvcc_doc._revisions.start=parseInt(r[0]);
        mvcc_doc._revisions.ids.unshift(r[1]);

        //3. push it in mvcc db
        if(!await this.dbdaomap[dbname].update(R._mvcc,mvcc_doc._id,(old_obj:any)=>{
            return mvcc_doc;
        },mvcc_doc)){
            console.log("MVCC not updated");
        }

        return {id: doc[R._id], rev: doc[R._rev]};
    }

    private _ifFoundNoDBCreateResponse(dbname:string){
        if(!this.dbdaomap[dbname]){
            return Utils.sendJsonResponse({error: `DB<${dbname}> do not exist`}, 404);
        }
    }

    /**
     * Makes a record in _changes object store for the DB.\
     * **Do check if DB exist or not prior to calling this method**
     * @param doc 
     */
    private async recordAChangeIn_changesDB(dbname:string, doc: any, isCallFromPutDesign:boolean=false){
        //if doc is a design and call is not from putDesign, then don't update the change record, as its already taken care by put design call done separately
        if((doc._id as string).startsWith("_design/") && !isCallFromPutDesign){
            return true;
        }
        const isDeleted = doc[R._deleted]?true:false;
        let n = this.dbdaomap[dbname].change_seq;
        const seq = `${n}-${EncryptionEngine.uuid()}`;
        let changeDoc:any = {id: doc[R._id],changes:[{rev:doc[R._rev]}],seq:seq, _id:n};
        if(isDeleted){
            changeDoc[R.deleted]=true;
        }
        
        return await this.dbdaomap[dbname].create(R._changes,changeDoc);
    }

    private async POST_A_NEW_DOC(direction:PathDirection, req:Request):Promise<Response>{
        try{
            const dbname = direction.path_params["db"];
            let doc = await req.json();

            const dbDesign:DBDesign = this._db_design_map[dbname];
            if(dbDesign && dbDesign.doc_validation_function){
                let valMessage = await dbDesign.doc_validation_function({recliner:this,direction,req},doc,"insert");
                if(valMessage){
                    return Utils.sendOnlyStatus(400,valMessage);
                }
            }

            return await this._post_a_doc(dbname,doc);
        }catch(e){
            console.error(e);
            return Utils.sendJsonResponse({
                ok: false
            },500, e.message);
        }
    }

    private async _post_a_doc(dbname: string, doc:any): Promise<Response>{
        //check DB exist
        const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
        if(foundNoDB){
            return foundNoDB;
        }
        //check doc exist
        if(doc[R._id]){
            const docid=doc[R._id];
            const currentRevOfDoc = await this._checkDocExistAndGetRev(dbname,docid,true);
            const isDeleted = await this._checkDocExistAndGetRev(dbname,docid)&&currentRevOfDoc?false:true;

            //documents which are reqeusted to be deleted are simply marked as _deleted: true , as per couchdb norm and not removed
            //completely. 
            //below checks make sure everything goes as per that, if it encounter a doc which is marked as deleted.

            //if its not deleted and has a rev
            if(currentRevOfDoc && !isDeleted){
                return Utils.sendOnlyStatus(409, "A Conflicting Document with same ID already exists",{"ETag":currentRevOfDoc});
            }else{
                //its time to delete it, for always.
                if(!await this.dbdaomap[dbname].delete(R._id,docid)){
                    return Utils.sendOnlyStatus(500, "A Conflicting Document is not letting the doc delete!",{"ETag":currentRevOfDoc});
                }
            }
        }

        //modify doc
        const id_rev = await this.makeDocReadyForUpdates(dbname,doc);
        
        //update _changes table
        if(!await this.recordAChangeIn_changesDB(dbname,doc)){
            return Utils.sendJsonResponse({ok: false},500,"Failed to make a record in _changes db");
        }

        if(await this.dbdaomap[dbname].create(R._id,doc)){
            return Utils.sendJsonResponse({...id_rev, ok: true},201);
        }else{
            return Utils.sendJsonResponse({ok: false},500);
        }
    }

    private async CHECK_DOC_EXISTENCE(direction: PathDirection){
        const dbname = direction.path_params["db"];
        //check DB exist
        const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
        if(foundNoDB){
            return foundNoDB;
        }
        const docid = direction.path_params["docid"];
        const rev = await this._checkDocExistAndGetRev(dbname,docid);
        if(rev){
            return Utils.sendOnlyStatus(200,undefined,{"ETag":rev});
        }else{
            return Utils.sendOnlyStatus(404);
        }
    }

    private async _checkDocExistAndGetRev(dbname:string, docid:string, skipDeletedDoc:boolean=true):Promise<string|undefined>{
        const doc = await this.dbdaomap[dbname].read(R._id,docid);
        if(doc && doc[R._deleted] && skipDeletedDoc){
            return;
        }else{
            return doc?doc[R._rev]:undefined;
        }
        
    }

    private async GET_THE_DOCUMENT(direction: PathDirection){
        const dbname = direction.path_params["db"];
        //check DB exist
        const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
        if(foundNoDB){
            return foundNoDB;
        }
        const docid = direction.path_params["docid"];
        const getObject = await this.dbdaomap[dbname].read(R._id,docid);
        if(getObject && !getObject[R._deleted]){
            return Utils.sendJsonResponse(getObject,200);
        }else{
            return Utils.sendOnlyStatus(404,"Document not found");
        }
    }


    private async GET_LOCAL_DOC(direction: PathDirection){
        const dbname = direction.path_params["db"];
        //check DB exist
        const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
        if(foundNoDB){
            return foundNoDB;
        }
        const docid = direction.path_params["docid"];
        const getObject = await this.dbdaomap[dbname].read(R._local,docid);
        if(getObject && !getObject[R._deleted]){
            return Utils.sendJsonResponse(getObject,200);
        }else{
            return Utils.sendOnlyStatus(404,"Document not found");
        }
    }

    private async CHECK_LOCAL_DOC(direction: PathDirection){
        const dbname = direction.path_params["db"];
        //check DB exist
        const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
        if(foundNoDB){
            return foundNoDB;
        }
        const docid = direction.path_params["docid"];
        const getObject = await this.dbdaomap[dbname].read(R._local,docid);
        if(getObject && !getObject[R._deleted]){
            return Utils.sendOnlyStatus(200,"OK");
        }else{
            return Utils.sendOnlyStatus(404,"Document not found");
        }
    }

    private async PUT_A_LOCAL_DOC(direction: PathDirection, req: Request){
        try{
            const dbname = direction.path_params["db"];
            //check DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }
            const docid = direction.path_params["docid"];
            if(!docid){
                return Utils.sendJsonResponse({error:"Local Doc must have a _id field!"},400);
            }
            const doc:any = await req.json();
            doc["_id"]=docid;

            if(await this.dbdaomap[dbname].update(R._local,doc._id,(oldObject:any)=>{
                return doc;
            },doc)){
                return Utils.sendOnlyStatus(200);
            }else{
                return Utils.sendOnlyStatus(500);
            }
        }catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue!");
        }
    }

    private async DELETE_A_LOCAL_DOC(direction: PathDirection){
        try{
            const dbname = direction.path_params["db"];
            //check DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }
            const docid = direction.path_params["docid"];

            if(await this.dbdaomap[dbname].delete(R._local,docid)){
                return Utils.sendOnlyStatus(200);
            }else{
                return Utils.sendOnlyStatus(404);
            }
        }catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue!");
        }
    }


    private async SINGLE_TX_PUT(direction: PathDirection, req: Request){
        try{
            const dbname = direction.path_params["db"];
            //check DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }
            
            const body:{new_edits:boolean,docs:DBDoc[]} = await req.json();
            
            let filteredDocs:DBDoc[] =[];
            if(body.new_edits){
                //new_edits false happens only when user knows what they are doing, say by replication scenario.
                //and can be allowed to override something

                const dbDesign:DBDesign = this._db_design_map[dbname];
                if(dbDesign && dbDesign.doc_validation_function){
                    for(let doc of body.docs){
                        let valMessage = await dbDesign.doc_validation_function({recliner:this,direction,req},doc,"update");
                        if(!valMessage){
                            //if validation fails the doc is skipped
                            filteredDocs.push(doc);
                        }
                    }
                }
            }else{
                filteredDocs=body.docs;
            }

            const docsMap:{_id:DBDoc[],_mvcc:{_id:string,_revisions:MVCC}[],_changes:any[]} = {_id:[],_mvcc:[],_changes:[]};
            
            
            for(let doc of filteredDocs){
                //update id and rev on all docs to new value
                {
                    if(!doc[R._id]){
                        doc[R._id]=await EncryptionEngine.random_id();
                    }
            
                    const old_rev:string = doc[R._rev];
                    let new_rev:string;
                    if(!old_rev){
                        new_rev = `1-${await EncryptionEngine.sha1_hash(JSON.stringify(doc))}`
                    }else{
                        const t = old_rev.split("-");
                        let n = parseInt(t[0]);
                        n++;
                        delete doc[R._rev];
                        new_rev = `${n}-${await EncryptionEngine.sha1_hash(JSON.stringify(doc))}`
                    }
                    doc[R._rev]=new_rev;
                }

                if(body.new_edits){
                    //handle mvcc
                    {
                        //1. lets get the existing MVCC entry
                        let mvcc_doc:{_id:string,_revisions:{start:number,ids:string[]}}=await this.dbdaomap[dbname].read(R._mvcc,doc[R._id]);
                        
                        //2. update it
                        if(!mvcc_doc){
                            mvcc_doc={_id:doc[R._id],_revisions:{start:0,ids:[]}}
                        }
                        let rev = doc[R._rev];
                        let r = rev.split("-");
                        mvcc_doc._revisions.start=parseInt(r[0]);
                        mvcc_doc._revisions.ids.unshift(r[1]);
                        
                        docsMap._mvcc.push(mvcc_doc);
                    }

                    //TODO handle deleting of attachments if attachments are modified or docs are deleted

                    {
                        const isDeleted = doc[R._deleted]?true:false;
                        let n = this.dbdaomap[dbname].change_seq;
                        const seq = `${n}-${EncryptionEngine.uuid()}`;
                        let changeDoc:any = {id: doc[R._id],changes:[{rev:doc[R._rev]}],seq:seq, _id:n};
                        if(isDeleted){
                            changeDoc[R.deleted]=true;
                        }
                        docsMap._changes.push(changeDoc);
                    }
                }

                docsMap._id.push(doc);
            }

            //do bulk insert
            if(await this.dbdaomap[dbname].singleTxPut([R._id,R._mvcc,R._changes],docsMap)){
                return Utils.sendJsonResponse({ok: true},200); 
            }else{
                return Utils.sendJsonResponse({ok: false},500,"MultiPut in one TX failed"); 
            }

        }catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue!");
        }
    }


    private async PUT_A_DOC(direction: PathDirection, req: Request){
        try{
            const dbname = direction.path_params["db"];
            //check DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }
            const docid = direction.path_params["docid"];
            let currentRevOfDoc = await this._checkDocExistAndGetRev(dbname,docid);
            
            //check if rev id is given in the query param
            const url =  new URL(req.url);
            let rev_in_query_param = url.searchParams.get("rev");
            
            const ne = url.searchParams.get("new_edits");
            let new_edits=true;
            if(ne){
                new_edits=ne==="false"?false:true;
            }
            
            let doc:any = await req.json();
            if(new_edits){
                //new_edits false happens only when user knows what they are doing, say by replication scenario.
                //and can be allowed to override something

                const dbDesign:DBDesign = this._db_design_map[dbname];
                if(dbDesign && dbDesign.doc_validation_function){
                    let valMessage = await dbDesign.doc_validation_function({recliner:this,direction,req},doc,"update");
                    if(valMessage){
                        return Utils.sendOnlyStatus(400,valMessage);
                    }
                }
            }
            

            if(!new_edits){
                if(doc._rev){
                    currentRevOfDoc=doc._rev;
                    rev_in_query_param=doc._rev;
                }
            }

            return await this._put_the_doc(dbname,doc,docid,currentRevOfDoc,rev_in_query_param, new_edits);
            
        }catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue!");
        }
    }

    /**
     * Can even delete a doc if _deleted flag is present!.
     * Is used primarily for RUN_UPDATE_FUNCTIONS
     * @param dbname 
     * @param doc 
     * @param docid 
     * @param currentRevOfDoc 
     * @param rev_in_query_param 
     * @param new_edits 
     * @returns 
     */
    private async _update_a_doc(dbname: string, doc: DBDoc, new_edits:boolean=true): Promise<DBPutResponse>{
        //modify doc rev and id
        const id_rev = await this.makeDocReadyForUpdates(dbname,doc,new_edits);
        

        //Deleting the attachments, as the doc is deleted too
        if(doc._deleted){
            const readDoc = await this.dbdaomap[dbname].read(R._id,id_rev.id);
            if(readDoc && this.checkIfDocHasAttachments(readDoc)){
                for(let attachment_name of Object.keys(readDoc._attachments)){
                    let anAttachment :{rak:string}=readDoc._attachments[attachment_name];
                    if(anAttachment.rak){
                        await this.dbdaomap[dbname].delete(R._attachments,anAttachment.rak);
                    }
                }
            }
        }
        
         //update _changes table
        if(new_edits && !await this.recordAChangeIn_changesDB(dbname,doc)){
            return {ok: false, reason:"Failed to make a record in _changes db",...id_rev};
        }

        const updateDoc = await this.dbdaomap[dbname].update(R._id,id_rev.id,(oldObject:any)=>{
            return doc;
        },doc);

        if(!updateDoc){
            return {ok: false, reason:"Failed to update doc in _id store ",...id_rev};
        }else{
            return {...id_rev, ok: true};
        }
    }

    /**
     * If new edits is true then it tries to modify the rev of the doc.
     * Will delete attachments too if it its an update for deleted doc
     * @param dbname 
     * @param doc 
     * @param docid 
     * @param currentRevOfDoc 
     * @param rev_in_query_param 
     * @param new_edits 
     */
    private async _put_the_doc(dbname: string, doc: DBDoc,docid:string, currentRevOfDoc:string, rev_in_query_param: string, new_edits:boolean=true){
        if(currentRevOfDoc){
            //case of update
            
            if(!rev_in_query_param){
                return Utils.sendOnlyStatus(400,"Invalid request body or parameters, provide rev as query param");
            }else{
                
                if(!doc){
                    return Utils.sendOnlyStatus(400,"Invalid request body or parameters, no body provided");
                }
                
                if(doc._id!==docid||doc._rev!==rev_in_query_param){
                    return Utils.sendOnlyStatus(400,"Invalid request body or parameters, _id/_rev mismatch, compare the one in doc and provided in url", {"ETag":currentRevOfDoc});
                }

                if(rev_in_query_param !== currentRevOfDoc){
                    return Utils.sendOnlyStatus(409,"Document with the specified ID already exists or specified revision is not latest for target document", {"ETag":currentRevOfDoc});
                }
                
                //modify doc rev and id
                const id_rev = await this.makeDocReadyForUpdates(dbname,doc,new_edits);

                const oldDoc:DBDoc = await this.dbdaomap[dbname].read(R._id,docid);
                //TODO Deleting the attachments, as the doc is deleted too
                if(oldDoc && this.checkIfDocHasAttachments(oldDoc)){

                    //compare oldDoc and new DOC and delete not applicable rak any more
                    for(let attachment_name of Object.keys(oldDoc.attachments)){
                        let oldDocRak=oldDoc.attachments[attachment_name]?.rak;
                        let newDocRak=doc.attachments?.[attachment_name]?.rak;

                        //   if doc is deleted
                        //or if new doc do not have a rak that means its deleted
                        //or if new doc rak and old doc rak do not match
                        if( doc._deleted || !newDocRak || ((oldDocRak && newDocRak!==oldDocRak))){
                            await this.dbdaomap[dbname].delete(R._attachments,oldDocRak);
                        }
                    }
                }
                
                 //update _changes table
                if(new_edits && !await this.recordAChangeIn_changesDB(dbname,doc)){
                    return Utils.sendJsonResponse({ok: false},500,"Failed to make a record in _changes db");
                }

                const updateDoc = await this.dbdaomap[dbname].update(R._id,docid,(oldObject:any)=>{
                    return doc;
                },doc);

                if(!updateDoc){
                    return Utils.sendOnlyStatus(500,"Unknown issue! failed to update the DB doc");
                }else{
                    return Utils.sendJsonResponse({...id_rev, ok: true},201); 
                }
            }
        }else{
            //case of post
            return await this._post_a_doc(dbname,doc);
        }
    }

    private async DELETE_THE_DOC(direction: PathDirection, req: Request){
        try{
            const dbname = direction.path_params["db"];
            //check DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }
            const docid = direction.path_params["docid"];
            const readDoc = await this.dbdaomap[dbname].read(R._id,docid);
            if(readDoc){
                //Running validation function
                const dbDesign:DBDesign = this._db_design_map[dbname];
                if(dbDesign && dbDesign.doc_validation_function){
                    let valMessage = await dbDesign.doc_validation_function({recliner:this,direction,req},readDoc,"delete");
                    if(valMessage){
                        return Utils.sendOnlyStatus(400,valMessage);
                    }
                }

                const currentRevOfDoc = readDoc._rev;
                
                //check if rev id is given in the query param
                const url =  new URL(req.url);
                const rev = url.searchParams.get("rev");
                if(!rev){
                    return Utils.sendOnlyStatus(400,"Invalid request body or parameters, provide rev as query param");
                }else{

                    if(rev !== currentRevOfDoc){
                        return Utils.sendOnlyStatus(409,"Specified revision is not the latest for target document", {"ETag":currentRevOfDoc});
                    }
                    
                    let doc :any = {_id: docid, _rev: currentRevOfDoc, _deleted: true};
                    let keep_field = req.headers.get("keep_field");
                    if(keep_field){
                        //comma separated list lets break it down
                        const fields = keep_field.split(",");
                        for(let f of fields){
                            let t = f.trim();
                            if(t.length>0){
                                doc[t]=readDoc[t];
                            }
                        }
                    }

                    //modify doc rev and id
                    const id_rev = await this.makeDocReadyForUpdates(dbname,doc);

                    //TODO Deleting the attachments, as the doc is deleted too
                    if(this.checkIfDocHasAttachments(readDoc)){
                        for(let attachment_name of Object.keys(readDoc.attachments)){
                            let anAttachment :{rak:string}=readDoc.attachments[attachment_name];
                            if(anAttachment.rak){
                                await this.dbdaomap[dbname].delete(R._attachments,anAttachment.rak);
                            }
                        }
                    }
                    
                    //update _changes table
                    if(!await this.recordAChangeIn_changesDB(dbname,doc)){
                        return Utils.sendJsonResponse({ok: false},500,"Failed to make a record in _changes db");
                    }

                    const updateDoc = await this.dbdaomap[dbname].update(R._id,docid,(oldObject:any)=>{
                        return doc;
                    });

                    if(!updateDoc){
                        return Utils.sendOnlyStatus(500,"Unknown issue! failed to update the DB doc");
                    }else{
                        return Utils.sendJsonResponse({...id_rev, ok: true},200); 
                    }
                }
            }else{
                return Utils.sendOnlyStatus(404,"Document not found");
            }
        }catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue!");
        }
    }

    /**
     * Create index.
     * @param direction 
     * @param req 
     */
    private async CREATE_INDEX(direction: PathDirection, req: Request){
        try{
            const dbname: string = direction.path_params["db"];
            //check DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }

            const index_info:CREATE_INDEX_BODY = await req.json();
            if(!(index_info.ddoc && index_info.name && index_info.index && index_info.index.fields && Array.isArray(index_info.index.fields))){
                return Utils.sendOnlyStatus(400,"Incorrect index body provided for creating an index. Check docs to know correct body format");
            }

            //will overwrite indexes if already present.
            /**
             * Algo for index creation:
             * 1. Create a design object, based on index_info given.
             * 2. Create the design for it.
             */
            const design: Design = {
                _id: `_design/${index_info.ddoc}`,
                language:"query",
                views:{                    
                }
            }

            const sort:{[field_name:string]:"asc"|"desc"}={}
            index_info.index.fields.forEach(e=>{
                sort[e]="asc";
            })

            if(index_info.index.sort){
                for(let s of index_info.index.sort){
                    const key = Object.keys(s)[0];
                    sort[key]=s[key];
                }
            }
             
            design.views[`${index_info.name}`]={
                options:{
                    def:{
                        fields:index_info.index.fields
                    }
                },
                map:{
                    fields: sort
                }
            }

            return await this._put_the_design(dbname,design);

        }catch(e){
            console.error("Error while creating index");
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue, check logs!");
        }
    }
    
    /**
     * 
     * @param direction 
     * @param req 
     */
    private async FIND_IN_INDEX(direction: PathDirection, req: Request):Promise<Response>{
        try{
            const dbname: string = direction.path_params["db"];
            //check DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }

            let index_fields: string[] = [];
            let query:RecQuery;
            if(req.method==="POST"){
                query = await req.json(); 
            }else if(req.method==="GET"){
                try{
                    let u = new URL(req.url);
                    let q = u.searchParams.get("q"); 
                    query=JSON.parse(decodeURI(q));   
                }catch(e){
                    return Utils.sendOnlyStatus(400);
                }
            }
            

            const limit = query.limit!==undefined?query.limit:-1;
            const skip = query.skip!=undefined?query.skip:0;
            const bookmark = query.bookmark;

            const selector : Selector = query.selector;
            if(!selector){
                return Utils.sendOnlyStatus(400,"Bad request: No selector provided");
            }

            let sort = query.sort;

            if(query.use_index){
                if(query.use_index.length!=2){
                    return Utils.sendOnlyStatus(400,"Bad request: For finding in index, use_index must be provided, which is an array of length two, of form:['ddoc_name','index_name']")
                }
                
                const ddoc_name = query.use_index[0];
                const index_name = query.use_index[1];
                
                const des: Design = await this._getDesignIfExist(dbname,ddoc_name);
                if(!des){
                    return Utils.sendOnlyStatus(400,`Bad request: no design found for design ${ddoc_name}`) ;
                }else{
                    if(!des.views || !des.views[index_name]){
                        return Utils.sendOnlyStatus(400,`Bad request: no index ${index_name} found on design ${ddoc_name}`) ;
                    }
                }
                if(!sort){
                    sort = this._getSortFromDesign(des,index_name);
                    if(!sort){
                        return Utils.sendOnlyStatus(500, `Bad design: the design ${ddoc_name} set up is incorrect, it has no sorting defined in map.fields`);
                    }
                }
                
                index_fields = this._getFieldsFromDesign(des,index_name);
            }
            
            const find_result: FindResult = await this.dbdaomap[dbname].find({dbname: R._id, selector,sort,limit,skip,bookmark,fields: query.fields});//R._id,selector,sort,limit, skip,bookmark,query.fields);

            //TODO passing bookmark
            if(find_result){
                if(query.render){
                    let r={body:(find_result.docs as any),content_type:"application/json"};
                    for(let rnf_name of query.render.pipeline){
                        let rnf = this._db_design_map[dbname].render_functions[rnf_name];
                        if(!rnf){
                            return Utils.sendJsonResponse({ok:false,msg:`${rnf_name} render funtion not found`},404);
                        }else{
                            r = await rnf(r,query.render.input_data);
                        }
                    }
                    return Utils.sendCustomResponse(r.body,200,r.content_type);
                }else{
                    return Utils.sendJsonResponse(find_result,200);
                }
            }else{
                throw `No find result found!`;
            }
        //FIND_IN_INDEX_BODY
        }catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue, check logs!");
        }
    }

    private _getFieldsFromDesign(des:Design, index_name:string){
        const o = des.views[index_name].options;
        if(o){
            return o.def.fields;
        }
    }

    // Do check if design has views , before calling this
    private _getSortFromDesign(des:Design,index_name:string):Sort{
        const m = des.views[index_name].map;
        if(typeof m === "object"){
            return m.fields
        }
    }

    private async CHECK_DESIGN_DOC_EXISTENCE(direction: PathDirection){
        try{
            const dbname = direction.path_params["db"];
            //check DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }

            const ddoc_name = direction.path_params["ddoc"];
            const des : Design = await this._getDesignIfExist(dbname,`_design/${ddoc_name}`);
            if(des){
                const rev = des._rev;
                return Utils.sendOnlyStatus(200,undefined,{ETag: rev});
            }else{
                return Utils.sendOnlyStatus(404);
            }
        }catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue, see logs for more details!");
        }
    }

    /**
     * No Sanity check for the design doc
     * @param direction 
     * @param req 
     */
    private async PUT_A_DESIGN_DOC(direction: PathDirection, req: Request):Promise<Response>{
        try{
        const dbname = direction.path_params["db"];
        //check DB exist
        const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
        if(foundNoDB){
            return foundNoDB;
        }

        const ddoc: Design = await req.json();
        return await this._put_the_design(dbname,ddoc);

        }catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue, see logs for more details!");
        }
    }

    async _put_the_design(dbname:string, ddoc: Design, new_edits:boolean=true){

        if(!ddoc._id){
            return Utils.sendOnlyStatus(400,"Design doc do not have _id field, it name must be like: _design/yourDesignName");
        }

        const ddoc_name = ddoc._id;
        const id_rev:ID_REV = await this.makeDocReadyForUpdates(dbname,ddoc,new_edits);
        
        /**
         * 1. Check if design exist.
         * 2. If no, then create it , else update it.
         * 3. update changes table
         * 4. update the version of DB in _system DB _db-info store.
         * 5. Discard and close previous ReclinerDAO. (this step is done by _get_db_dao method in this class)
         * 6. Create new ReclinerDAO.
         */

         //1. Check if design exist.
        const designExist:Design = await this._getDesignIfExist(dbname, ddoc_name);

        //2. If no, then create it , else update it.
        if(designExist){
            //TODO : Add a flag in _put_the_design, to instead have additive effect, say user use create index and keeps same design name , then they both muts be created in the same design
            const updateDesign:boolean = await this.dbdaomap[dbname].update(R._design,ddoc_name,(oldDesign: Design)=>{
                return ddoc;
            })
            if(!updateDesign){
                return Utils.sendOnlyStatus(500,`Failed to update design: ${ddoc_name}`);
            }
        }else{
            const createDesign:boolean = await this.dbdaomap[dbname].create(R._design,ddoc);
            if(!createDesign){
                return Utils.sendOnlyStatus(500,`Failed to create design: ${ddoc_name}`);
            }
        }

        //2.5 lets put this design in _id table (used during replication)
        //lets read the design as is rev is updated
        const savedDDOC = await this.dbdaomap[dbname].read(R._design,ddoc._id);
        const put_des_doc_in_id= await this._put_the_doc(dbname,savedDDOC,savedDDOC._id,savedDDOC._rev,savedDDOC._rev,false);
        if(put_des_doc_in_id.status!==201){
            return Utils.sendJsonResponse({ok: false},500,"Failed to make a saved ddoc copy in _id object store.");
        }

        //3. update changes table
        if(!await this.recordAChangeIn_changesDB(dbname,ddoc,true)){
            return Utils.sendJsonResponse({ok: false},500,"Failed to make a record in _changes db");
        }

        //4. update the version of DB in _system DB _db_info store.
        const updateVersionOfInSystemDB = await this._system_db_dao.update(R._db_info,dbname,(oldDoc)=>{
            let n:number = oldDoc.version;
            n++;
            oldDoc.version=n;
            return oldDoc;
        });

        if(!updateVersionOfInSystemDB){
            return Utils.sendOnlyStatus(500,`Failed to update version of DB in _db_info store of _system while putting design: ${ddoc_name}`);
        }

        const newDBDoc = await this._system_db_dao.read(R._db_info,dbname);
        const newVersion = newDBDoc.version;
        const listofDBDetails = newDBDoc.listofDBDetails;

        //6. Create new ReclinerDAO.
        //_get_db_dao: sets new version,updated dbdaomap
        await this._get_db_dao(dbname,newVersion,listofDBDetails);

        return Utils.sendJsonResponse({...id_rev,ok:true},201);
    }

    async _getDesignIfExist(dbname: string, designName:string): Promise<Design|undefined>{
        const doc = await this.dbdaomap[dbname].read(R._design,designName);
        return doc?doc:undefined;
    }

    /**
         * Sample attachment output:
         * 
```
{
  "_id": "45653700cf24d84c03bde0b7da774936",
  "_rev": "2-5b2cc93d3247ccae106d3e25f1307a2a",
  "by": "93cf74a196a3bf68e8ecd7a8d401e0fd",
  "at": 1603410834919,
  "_attachments": {
    "0.webp": {
      "content_type": "image/webp",
      "revpos": 0,
      "digest": "md5-Jvsjh0XETKek6Py0nf1CRw==",
      "length": 9878,
      "stub": true
    }
  }
}
```
Every DB has a _attachment object store, to save the attachments.
_attachments key will be unique hash (EncryptionEngine.random_id())

in the doc, it will be stored as :

"_attachments": {
    "0.webp": {
      "content_type": "image/webp",
      "revpos": 0,
      "digest": "md5-Jvsjh0XETKek6Py0nf1CRw==",
      "length": 9878,
      "stub": true,
      "reckey":"asqwedasdasdasdasd2e" //this will be added to docs on each attachment addition, and will remove them if replicating to remote system.
    }
  }
         * 
         */

    
    private async DELETE_THE_ATTACHMENT_OF_THE_DOC(direction:PathDirection, req: Request):Promise<Response>{
        try{
            const dbname = direction.path_params["db"];
            //check DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }
            const docid = direction.path_params["docid"];
            const attachment_name= direction.path_params["attachment"];

            const url =  new URL(req.url);
            const rev = url.searchParams.get("rev");
            const existingDocRev = await this._checkDocExistAndGetRev(dbname,docid);
            if(!rev){
                //check if docid exist, if it exist then throw error
                if(existingDocRev){
                    return Utils.sendOnlyStatus(409,"Document revision was not specified or it is not the latest.",{ETag: existingDocRev});
                }
            }else{
                if(rev!==existingDocRev){
                    return Utils.sendOnlyStatus(409,"Document revision was not specified or it is not the latest.",{ETag: existingDocRev});
                }
            }

            const dao: ReclinerDAO = this.dbdaomap[dbname];
            const attInfo=await this._getAttachmentInfo(dbname,docid,attachment_name);
            
            if(attInfo){
                //lets delete the attachment first from _attachment table.
                const rak = attInfo[R.recliner_attachment_key];
                await dao.delete(R._attachments,rak);
                
                //remove it from doc and update it
                const doc = await dao.read(R._id, docid);
                delete doc._attachments?.[attachment_name];
                delete doc.attachments?.[attachment_name];

                const updateTheDoc = await this._put_the_doc(dbname,doc,docid,existingDocRev,rev);
                if(updateTheDoc.status===201){
                    return Utils.sendJsonResponse(await updateTheDoc.json(),200);//sendOnlyStatus(200, "Attachment deleted", {ETag: updateTheDoc.headers.get(R.ETag)});
                }else{
                    return Utils.sendOnlyStatus(500, "Failed to update the doc after deleting the attachment");
                }

            }else{
                return Utils.sendOnlyStatus(404,"No such attachment present on doc");
            }

        }catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue, see logs for more details!"); 
        }
    }
    
    private async PUT_AN_ATTACHMENT_TO_THE_DOC(direction: PathDirection, req: Request):Promise<Response>{
       try{
         
        const dbname = direction.path_params["db"];
        //check DB exist
        const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
        if(foundNoDB){
            return foundNoDB;
        }
        const docid = direction.path_params["docid"];
        const attachment_name= direction.path_params["attachment"];

        const mimetype = req.headers.get("Content-Type");
        if(!mimetype){
            return Utils.sendOnlyStatus(400,"For attaching an attachment you muts supply 'Content-Type' header.");
        }
        const url =  new URL(req.url);
        const rev = url.searchParams.get("rev");
        //if replace is present then the blob is only replaced
        const replace = url.searchParams.get("replace");
        const doc = await this.dbdaomap[dbname].read(R._id,docid);
        const existingDocRev = doc?doc._rev:undefined;
        if(!rev){
            //check if docid exist, if it exist then throw error
            if(existingDocRev && !replace){
                return Utils.sendOnlyStatus(409,"Document revision was not specified or it is not the latest.",{ETag: existingDocRev});
            }
        }else{
            if(rev!==existingDocRev){
                return Utils.sendOnlyStatus(409,"Document revision was not specified or it is not the latest.",{ETag: existingDocRev});
            }
        }
        const cloud_url:string = req.headers.get(R.cloud_url);
        
        //every put an attachment should create a new rak
        let attachmentKey: string =  await EncryptionEngine.uuidRandom();
        if(cloud_url && cloud_url!=="undefined"){
            attachmentKey = await EncryptionEngine.sha1_hash(cloud_url);
        }
        let blob:Blob = await req.blob();
        
        const dao: ReclinerDAO = this.dbdaomap[dbname];

        if(await dao.updateItemWithKey(R._attachments,attachmentKey,blob)){
            //we will update the doc, too with new attachment info
            let doc:any= {};
            
            if(existingDocRev){
                //get the doc
                doc = await dao.read(R._id, docid);
            }else{
                doc._id=docid;
            }

            if(!doc._attachments){
                doc.attachments={};
                doc._attachments={};
            }
            
            //lets update the attachment doc.
            const t1:DBDocAttachmentInfo={
                content_type: mimetype,
                stub: true,
                rak: attachmentKey,//rak = recliner attachment key
                length:blob.size,
            };
            if(cloud_url && cloud_url !== "undefined"){
                t1.cloud_url=cloud_url;
            }

            doc._attachments[attachment_name]=t1;
            doc.attachments[attachment_name]={...t1};

            const ne = url.searchParams.get("new_edits");
            let new_edits=true;
            if(ne){
                new_edits=ne==="false"?false:true;
                if(replace){
                    new_edits=false;
                }
            }

            return await this._put_the_doc(dbname,doc,doc[R._id],existingDocRev,doc._rev,new_edits);
        }else{
            return Utils.sendOnlyStatus(500,"Unknown issue, while saving attachment"); 
        }
       }catch(e){
        console.error(e);
        return Utils.sendOnlyStatus(500,"Unknown issue, see logs for more details!");
       }
    }


    private async CHECK_ATTACHMENT_EXISTENCE(direction:PathDirection, req: Request):Promise<Response>{
        try{
            const dbname = direction.path_params["db"];
            //check DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }
            const docid = direction.path_params["docid"];
            const attachment_name= direction.path_params["attachment"];

            const att = await this._getAttachmentInfo(dbname,docid,attachment_name);
            if(att){
                const url =  new URL(req.url);
                const physical = url.searchParams.get("physical")?true:false;
                if(physical){
                    if(!await this.dbdaomap[dbname].checkKey(R._attachments,att.rak)){
                        return Utils.sendOnlyStatus(404);
                    }
                }
                return Utils.sendOnlyStatus(200);
            }else{
                return Utils.sendOnlyStatus(404);
            }

        }catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue, see logs for more details!");
        }
    }

    private async _getAttachmentInfo(dbname: string, docid: string, attachment_name: string):Promise<DBDocAttachmentInfo|undefined>{
        try{
            const doc  = await this.dbdaomap[dbname].read(R._id,docid);
            if(!doc){
                return;
            }

            if(!doc.attachments){
                return;
            }

            if(!doc.attachments[attachment_name]){
                return;
            }
            return doc.attachments[attachment_name];
        }catch(e){
            console.error(e);
            return;
        }
    }

    /**
     * Used as a registry to check which partial-content prefetch is under progress 
     */
    private currentFetchInProgress:Record<string,Promise<void>>={};

    // /**
    //  * 1. It will check if the nextBloc (if applicable) is present (if applicable) in the _partial_content DB
    //  * 2. Else it will download it and store it
    //  * @param param0 
    //  * @returns 
    //  */
    // private async checkAndPreFetchNextBlocks({cloud_url,currentBlockNumber,bufferSize,dao,req,max_blocs,contentLength,numberOfPreFetch}:{numberOfPreFetch:number,contentLength:number,cloud_url:string, currentBlockNumber:number,bufferSize:number,dao:ReclinerDAO,req:Request,max_blocs:number}){
    //     let i=0;
    //     while(i<numberOfPreFetch){
    //         let nextBlockNumber=currentBlockNumber+i+1;
    //         if(nextBlockNumber>max_blocs){
    //             //do nothing
    //             return;
    //         }

    //         const start = (nextBlockNumber-1)*bufferSize;
    //         const end = Math.min(nextBlockNumber*bufferSize-1,contentLength-1);

    //         const pc_id=await EncryptionEngine.sha1_hash(cloud_url+`${bufferSize}_${start}_${end}`);

    //         //if its already in prefetch then do nothing
    //         if(this.currentFetchInProgress[pc_id]){
    //             continue;
    //         }

    //         this.currentFetchInProgress[pc_id]=new Promise<void>(async res=>{
    //             try{
    //                 //lets search the content in partial content db
    //                 let docIsPresent = await dao.checkKey(R._partial_contents,pc_id);
    //                 if(!docIsPresent){
    //                     //if doc is not present then do a cloud url range fetch
    //                     let cloudFetch = await fetch(cloud_url,{
    //                         method:"GET",
    //                         mode: req.mode,
    //                         headers:Utils.combine_headers(req.headers,{
    //                             Range:`bytes=${start}-${end}`
    //                         })
    //                     });
    //                     if(cloudFetch.status!==206){
    //                         let e=`Issue while fetching next partial content from cloud: <${cloudFetch.status}> ${cloudFetch.statusText}`;
    //                         console.error(e);
    //                     }else{
    //                         let resultBlob:Blob = await cloudFetch.blob();

    //                         if(!await dao.updateItemWithKey(R._partial_contents,pc_id,resultBlob)){
    //                             console.error("Recliner: Error while saving partial content");
    //                         }
    //                         i++;
    //                     }
    //                 }
    //                 res();
    //             }catch(e){
    //                 console.error(e);
    //                 res();
    //             }finally{
    //                 res();
    //             }
    //         });

    //         await this.currentFetchInProgress[pc_id];
    //         delete this.currentFetchInProgress[pc_id];
    //     }
    // }

    private async GET_ATTACHMENT_FOR_THE_DOC(direction:PathDirection, req: Request):Promise<Response>{
        try{
            const dbname = direction.path_params["db"];
            //check DB exist
            const foundNoDB = this._ifFoundNoDBCreateResponse(dbname);
            if(foundNoDB){
                return foundNoDB;
            }

            const dao=this.dbdaomap[dbname];

            const docid = direction.path_params["docid"];
            const attachment_name= direction.path_params["attachment"];
            const attachment_info = await this._getAttachmentInfo(dbname,docid,attachment_name);

            const url =  new URL(req.url);
            const download = url.searchParams.get("download")?true:false;
 
            let headers:any;
            if(download){
                headers={"Content-Disposition":`attachment; filename="${attachment_name}"`}
            }
            
            if(attachment_info){
                const cloud_url=attachment_info[R.cloud_url];
                const get_fresh_copy_from_lazy_link = req.headers.get(R.get_fresh_copy_from_lazy_link);
                
                //if cloud url is present we will create the rak out of hash of the url
                const rak = attachment_info[R.recliner_attachment_key];//cloud_url?await EncryptionEngine.sha1_hash(cloud_url) : attachment_info[R.recliner_attachment_key];

                // //if the new rak is not same as the one present on the attachment_info, we will delete the old one
                // if(attachment_info[R.recliner_attachment_key] !== rak){
                //     //lets delete the old rak
                //     let rak_to_delete = attachment_info[R.recliner_attachment_key];
                //     await this.dbdaomap[dbname].delete(R._attachments,rak_to_delete);
                // }
                
                const mime = attachment_info.content_type;
                //if a get_fresh_copy_from_lazy_link header is provided then too it will save this 
                let blob:Blob = get_fresh_copy_from_lazy_link==="true"?undefined:await dao.read(R._attachments,rak);
                if(blob){
                     //lets check if this type of content needs to be returned via partial content
                     let bufferSize=this.partialContentConfig[mime];
                     //TODO here buffer size can be provided for adaptive streaming!
                     //buffer size can be obtained via req header which can be used to select a cloud URL, for adaptive stream.
                     //a smaller buffer size on a small size cloud url can be done to do adaptive streaming!
                    const url =  new URL(req.url);
                    const full = url.searchParams.get("full");
 
                    if(bufferSize  && full!=="true"){
                        const rangeHeader=req.headers.get("range");
                        if(!rangeHeader){
                            return Utils.sendOnlyStatus(400,"Range header is must");  
                        }
                        let reqAt = Number(rangeHeader.replace(/\D/g, ""));
                        if(isNaN(reqAt)){
                            return Utils.sendOnlyStatus(400,"Range header must be number");  
                        }
 
 
                        const start = Math.floor(reqAt);
                        let end = start+bufferSize;
                        if(end>=blob.size){
                            end=blob.size;
                        }
 
                        let newBlob = blob.slice(start,end);
 
                        return Utils.sendCustomResponse(newBlob,206,mime,{
                            "Connection":"keep-alive",
                            "keep-alive":"timeout=5",
                            "Content-Range": `bytes ${start}-${end-1}/${blob.size}`,
                            "Accept-Ranges": "bytes",
                            "Content-Length": newBlob.size,
                            "Content-Type": mime
                        });
                    }else{
                        return Utils.sendCustomResponse(blob,200,mime,headers);
                    }
                }else{
                    if(cloud_url){
                        //lets check if this type of content needs to be returned via partial content
                        let bufferSize=this.partialContentConfig[mime];
                        //TODO here buffer size can be provided for adaptive streaming!
                        //buffer size can be obtained via req header which can be used to select a cloud URL, for adaptive stream.
                        //a smaller buffer size on a small size cloud url can be done to do adaptive streaming!
                        const url =  new URL(req.url);
                        const full = url.searchParams.get("full");

                        if(bufferSize  && full!=="true"){
                            //ALGO: this means it should be picked by a partial content approach
                            //get range header, range header is must
                            //Based on Content length of attachment and range, determine where will it lie in.
                            //create hash of cloudurl+range
                            //check if _partial_contents db has this Blob
                            //if not present, make a partial request to cloud url and save it in _partial_content db
                            //retrieve the blob and return the blob with appropriate headers.
                            //no rak will be created, and this item will always be returned with partial content approach
                            
                            const contentLength = attachment_info.length;
                            const rangeHeader=req.headers.get("range");
                            if(!rangeHeader){
                                return Utils.sendOnlyStatus(400,"Range header is must");  
                            }
                            let reqAt = Number(rangeHeader.replace(/\D/g, ""));
                            if(isNaN(reqAt)){
                                return Utils.sendOnlyStatus(400,"Range header must be number");  
                            }


                            const userReqRangeStart = Math.floor(reqAt);

                            let blockNumber=Math.floor(userReqRangeStart/bufferSize)+1;
                            const MAXIMUM_BLOCKS=Math.ceil(contentLength/bufferSize);

                            //check if this block number exist in content length
                            if(blockNumber>MAXIMUM_BLOCKS){
                                return Utils.sendOnlyStatus(400,"Range out of content");  
                            }else{
                                //blockNumber is either <= to ranges available
                                //range of data required for this blockNumber
                                const start = (blockNumber-1)*bufferSize;
                                const end = Math.min(blockNumber*bufferSize-1,contentLength-1);

                                //get partial content id
                                //pc_id has buffer size to support adaptive streaming
                                let pc_id=await EncryptionEngine.sha1_hash(cloud_url+`${bufferSize}_${start}_${end}`);
                                
                                await this.currentFetchInProgress[pc_id];

                                let resultBlob:Blob;
                                //lets search the content in partial content db
                                let docIsPresent = await dao.checkKey(R._partial_contents,pc_id);
                                if(!docIsPresent){
                                    //if doc is not present then do a cloud url range fetch
                                    let cloudFetch = await fetch(cloud_url,{
                                        method:"GET",
                                        mode: req.mode,
                                        headers:Utils.combine_headers(req.headers,{
                                            Range:`bytes=${start}-${end}`
                                        })
                                    });
                                    if(cloudFetch.status!==206){
                                        let e=`Issue while fetching partial content from cloud: <${cloudFetch.status}> ${cloudFetch.statusText}`;
                                        console.error(e);
                                        throw e;
                                    }else{
                                        resultBlob = await cloudFetch.blob();
                                        //save this blob
                                        if(!await dao.updateItemWithKey(R._partial_contents,pc_id,resultBlob)){
                                            return Utils.sendOnlyStatus(500,"Error while saving partial content");  
                                        }
                                    }
                                }else{
                                    resultBlob = await dao.read(R._partial_contents,pc_id);
                                }

                                //buffer check and load next bloc if applicable
                                //next bloc is the one not present in the current sequence
                                // this.checkAndPreFetchNextBlocks({
                                //     bufferSize,
                                //     cloud_url,
                                //     contentLength,
                                //     currentBlockNumber:blockNumber,
                                //     dao,
                                //     max_blocs:MAXIMUM_BLOCKS,
                                //     req,
                                //     numberOfPreFetch:1
                                // });

                                if(!resultBlob){
                                    return Utils.sendOnlyStatus(500,"Error while retrieving partial content from indexedDB");  
                                }
                                
                                return Utils.sendCustomResponse(resultBlob,206,mime,{
                                    "Connection":"keep-alive",
                                    "keep-alive":"timeout=5",
                                    "Content-Range": `bytes ${start}-${end}/${contentLength}`,
                                    "Accept-Ranges": "bytes",
                                    "Content-Length": (end-start)+1,
                                    "Content-Type": mime
                                });
                            }

                        }

                        //lets try to download the attachment from cloud_url
                        const r1 = await fetch(cloud_url,{
                            headers:req.headers,
                            mode: req.mode
                        });
                        if(r1.status === 200){

                            //below checks ensure that a malicious cloud entry do not make recliner to download too big attachment than it expect.
                            //which can lead to client crash.
                            //BEGINS
                            let mccl_header = req.headers.get(R.max_cloud_content_length);
                            let max_cloud_content_length = parseInt(mccl_header);
                            if(!max_cloud_content_length){
                                max_cloud_content_length = attachment_info.length;
                            }

                            let cloud_fetch_content_length_header = r1.headers.get("content-length");
                            if(!cloud_fetch_content_length_header){
                                return Utils.sendOnlyStatus(502,"Cloud resource do not provides content length in response!");
                            }

                            let cloud_fetch_content_length = parseInt(cloud_fetch_content_length_header);
                            if(!cloud_fetch_content_length){
                                return Utils.sendOnlyStatus(502,"Cloud resource do not provides a valid value for content length!");
                            }

                            if(cloud_fetch_content_length > max_cloud_content_length){
                                return Utils.sendOnlyStatus(502,"Cloud resource bigger than max_cloud_content_length cap for this resource");
                            }
                            //ENDS

                            //lets save the blob
                            blob = await r1.blob();
                            if(await this.dbdaomap[dbname].updateItemWithKey(R._attachments,rak,blob)){
                                //lets also update attachment doc
                                if(await this.dbdaomap[dbname].update(R._id,docid,(oldObject:any)=>{
                                    if(!oldObject[R._attachments]){
                                        oldObject[R._attachments]={};
                                    }
                                    oldObject[R._attachments][attachment_name]=attachment_info;
                                    return oldObject;
                                })){
                                    return Utils.sendCustomResponse(blob,200,mime,headers);
                                }else{
                                    return Utils.sendOnlyStatus(r1.status,`Cannot update attachment length in doc after lazy download: ${docid}/${attachment_name}`);
                                }
                            }else{
                                return Utils.sendOnlyStatus(r1.status,`Cannot save blob to _attachment object store: ${docid}/${attachment_name}`);             
                            }
                        }else{
                            return Utils.sendOnlyStatus(r1.status,`Cannot retrieve blob from the cloud_url link: ${r1.statusText} ${await r1.text()} ${cloud_url}`);         
                        }
                    }else{
                        return Utils.sendOnlyStatus(404,"Cannot retrieve blob from the _attachments object store"); 
                    }
                }
            }else{
                return Utils.sendOnlyStatus(404,"No Such attachment present"); 
            }
        } catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue, see logs for more details!");
        }
    }

    private determineReplicationCase(replicationInfo: ReplicationInfoJSON): ReplicationCase{
        const srcIsLocal = replicationInfo.source.url.startsWith("/recliner");
        const tarIsLocal = replicationInfo.target.url.startsWith("/recliner");
        if(srcIsLocal && tarIsLocal){
            return ReplicationCase.LocalToLocal;
        }else if(srcIsLocal && !tarIsLocal){
            return ReplicationCase.LocalToRemote;
        }else if(!srcIsLocal && tarIsLocal){
            return ReplicationCase.RemoteToLocal;
        }else{
            return ReplicationCase.UnsupportedCase;
        }
    }

    private async REPLICATE(req:Request):Promise<Response>{
        try{
            
            const replicationInfo:ReplicationInfoJSON = await req.json();

            const replication_id:string = await this.createAReplicationID(replicationInfo);
            const session_id: string = await EncryptionEngine.random_id();
            
            const repCase : ReplicationCase = this.determineReplicationCase(replicationInfo);
            switch (repCase) {
                case ReplicationCase.LocalToLocal: return await this.replicateLocalToLocal(replication_id, session_id, replicationInfo);
                case ReplicationCase.LocalToRemote: return await this.replicateLocalToRemote(replication_id,session_id,replicationInfo);
                case ReplicationCase.RemoteToLocal: return await this.replicateRemoteToLocal(replication_id,session_id,replicationInfo);
                case ReplicationCase.UnsupportedCase: break;
                default: break;
            }
        }catch(e){
            console.error(e);
            return Utils.sendOnlyStatus(500,"Unknown issue, see logs for more details!");
        }
    }
    
     /**
     * 
     * @param replication_id 
     * @param session_id 
     * @param replicationInfo 
     */
    private async replicateRemoteToLocal(replication_id:string, session_id: string, replicationInfo:ReplicationInfoJSON):Promise<Response>{
        //get dbname
        const sourceUrl = replicationInfo.source.url;
        const t1 = sourceUrl.split("/");
        const sourceDBName=t1[t1.length-1];
        const targetDBName = this.uriEngine.getDBNameForLocalDB(replicationInfo.target.url);

        if(!(targetDBName)){
            return Utils.sendOnlyStatus(400,"Check Url for target, no DB name can be derived from it. The should be of form /recliner/dbname");
        }

        //check if target DB exist, it will create a local DB if it do not exist
        if(!this.dbdaomap[targetDBName]){
            //@ts-ignore
            const createTargetDB = await this.PUT_A_NEW_DB({path_params:{"db":targetDBName}});
            if(createTargetDB.status!==201){
                throw `Cannot create Target DB: ${targetDBName}`;
            }
        }

        const sourceDB_update_seq = await this.getRemoteDBUpdateSeq(sourceUrl,replicationInfo.source.headers);
        if(sourceDB_update_seq.startsWith("0")){
            return this._sendResponseIfLocalSourceDBHasNoChange(session_id);
        }
        //let end_seq be same as sourcedb update seq, we will set it to last-seq from change for selector and docIDs for respective cases
        let end_seq:string=sourceDB_update_seq;

        //get replication logs from source and target
        const sourceRepLogs:RepLogs = await this.getReplicationLogsForRemoteDB(replicationInfo.source.url,replication_id,replicationInfo.source.headers)||this.getFreshRepLogs(replication_id,session_id);
        const targetRepLogs:RepLogs = await this.getReplicationLogsForLocalDB(targetDBName,replication_id)||this.getFreshRepLogs(replication_id,session_id);
        //TODO only allow history of size 100, else doc will grow infinitely big

        //finding start_seq
        let start_seq:string="0";
        //lets compare last_session_id of both source and target
        if((sourceRepLogs.last_session_id === targetRepLogs.last_session_id) || (sourceRepLogs.source_last_seq.startsWith("0"))){
            let actualStartSeq:string;
            for(let h of sourceRepLogs.history){
                if(h.doc_write_failures!==0){
                    actualStartSeq="0";
                    continue;
                }else{
                    actualStartSeq=h.end_last_seq;
                }
            }
            start_seq=actualStartSeq||sourceRepLogs.source_last_seq;
        }else{
            const srcSessionIdMap=sourceRepLogs.history.reduce((p:RepLogsHistory,c:RepLogsHistory)=>{
                if(!(p as any)[c.session_id]){
                    (p as any)[c.session_id]=[];
                }
                (((p as any)[c.session_id]) as Array<string>).push(c.recorded_seq);
                return p;
            //@ts-ignore
            },{})
            
            const targetSessionIdMap=targetRepLogs.history.reduce((p:RepLogsHistory,c:RepLogsHistory)=>{
                if(!(p as any)[c.session_id]){
                    (p as any)[c.session_id]=[];
                }
                (((p as any)[c.session_id]) as Array<string>).unshift(c.recorded_seq);
                return p;
            //@ts-ignore
            },{})

            for(let session_id of Object.keys(targetSessionIdMap)){
                //@ts-ignore
                if(srcSessionIdMap[session_id] && (srcSessionIdMap[session_id] as Array).length>0){
                    //session id is present in both source and target.
                    //@ts-ignore
                    start_seq = (srcSessionIdMap[session_id] as Array<string>)[0];
                    //here we have used 0 as in history the rep logs are added by unshift, tha is added to history array from top.
                    break;
                }
            }
        }

        let bookmark:string;
        let limit:number= this.replication_bulk_doc_limit;

        let startTime = new Date().getTime();
        let session_start_seq = start_seq;
        let responseJson: ReplicationResponseJSON=this.getFreshReplicationResponseJSON(session_id,end_seq);

        responseJson.history[0].session_id=session_id;
        responseJson.history[0].start_last_seq=session_start_seq;
        responseJson.history[0].start_time=startTime;

        responseJson.replication_id_version=_replication_version;
        responseJson.session_id=session_id;
        responseJson.source_last_seq=end_seq;

        let maxDocWriteLimit:number = replicationInfo.limit && replicationInfo.limit>0?replicationInfo.limit:0;
        let totalWriteCounts=0;

        let pageData:PageData={
            limit:maxDocWriteLimit,
            since:start_seq
        }

        while(true){ 
             //loop breaking in
             if(start_seq === end_seq){
                break;
            }

            if(pageData.limit){
                //if its zero it will not come in here
                //however if limit has been set then
                if(totalWriteCounts>=pageData.limit){
                    break;
                }
            }
            
            //doc IDs to replicate
            let docIds:string[];
           
            //we have start_seq now
            //lets get changes from source
            //lets see if we have selector or docids
            let srcChangeReqJson: ChangeReqJson;
            if(replicationInfo.viewBasedReplication?.remoteViewUrl){
                srcChangeReqJson={
                    results:[],
                    last_seq:"0"
                }
                docIds = await this.getDocIDsFromViewQuery(replicationInfo,Utils.combine_headers(replicationInfo.source.headers,{
                    "Content-Type":"application/json",
                }),srcChangeReqJson,targetDBName);
                //a view based replication assumes that all values are picked in single go
                end_seq=srcChangeReqJson.last_seq;//Without this it creates infinite loop.
            }else if(replicationInfo.doc_ids){
                srcChangeReqJson = await this.getRemoteChangeReqJsonForDocIDs(replicationInfo.source.url,replicationInfo.doc_ids, Utils.combine_headers(replicationInfo.source.headers,{
                    "Content-Type":"application/json",
                }),pageData);
                pageData.since=srcChangeReqJson.last_seq;

                //setting end_seq
                end_seq=srcChangeReqJson.last_seq;
            }else if(replicationInfo.selector){
                srcChangeReqJson = await this.getRemoteChangeReqJsonForSelector(replicationInfo.source.url,replicationInfo.selector, Utils.combine_headers(replicationInfo.source.headers,{
                    "Content-Type":"application/json",
                }), pageData);
                pageData.since=srcChangeReqJson.last_seq;

                //setting end_seq
                end_seq=srcChangeReqJson.last_seq;
            }else{
                srcChangeReqJson =await this.getRemoteSourceChangeReqJsonForRange(sourceUrl,replicationInfo.source.headers,{
                    limit,
                    since:start_seq
                });
                pageData.since=srcChangeReqJson.last_seq;
                //in these case end_seq is equals to update_seq of source DB.
                //this value is assigned while initializing end_seq
            }

            //for remote view URL, the doc id will be supplied by the view query
            if(!replicationInfo.viewBasedReplication?.remoteViewUrl){
                //lets get latest rev of docs from target
                let revDiffRes:RevDiffRes= await this.getRevDiffFromLocalTarget(targetDBName,srcChangeReqJson);

                //now we have got the list of docs missing and there rev
                //we need to determine if doc is design or normal doc
                docIds=Object.keys(revDiffRes);
            }

            let docs: FlattenObject[];
            
            if(docIds.length>0){
                const r1 = await fetch(Utils.build_path(sourceUrl,"/_all_docs?include_docs=true"),{
                    method:"POST",
                    headers:Utils.combine_headers(replicationInfo.source.headers,{
                        "Content-Type":"application/json",
                    }),
                    body: JSON.stringify({
                        keys: docIds
                    })
                })
                if(r1.status!==200){
                    throw `Unable to fetch docs for replicating from remote source: ${sourceUrl}`;
                }
    
                const r12 = await r1.json();
                const rows = r12["rows"];
    
                //lets bulk get docs from source 
                docs = (rows as {id:string,value: {rev:string,deleted?:boolean},doc:FlattenObject}[]).map(e=>e.doc??{_id: e.id,_rev:e.value.rev,_deleted:true});
    
                //If not told to replicate design we will not replicate design docs from remote system to local
                if(!replicationInfo.replicate_design){
                    //only those docs whose _id doesnot starts with _design
                    docs = docs.filter(e=>!e._id.startsWith("_design/"));
                }
            }else{
                docs=[];
            }
            
            //TODO delete attachments for deleted docs
            /**
             * This is full and final rep logs
             */
            let replicationLogs:RepLogsHistory=this.getAFreshRepLogsHistory(session_id);

            if(docs.length>0){
                //lets iterate through them and process them, check if they have attachments
                replicationLogs.docs_read=docs.length;
                replicationLogs.end_last_seq=srcChangeReqJson.last_seq;
                
            for(let doc of docs){
                let docid = doc._id;
                if(docid.startsWith("_design/")){
                    //lets put this doc in target
                    const res = await this._put_the_design(targetDBName,doc as Design,false);
                    if(res.status!=201){
                        //logs errors
                        replicationLogs.doc_write_failures++;
                    }else{
                        replicationLogs.docs_written++;
                        totalWriteCounts++;
                    }
                }else{
                    //setting up documents with _attachments: adding rak, cloud url
                    if(doc._attachments && Object.keys(doc._attachments).length>0){
                        for(let attachment_name of Object.keys(doc._attachments)){
                            const attachment_info = doc._attachments[attachment_name];
                            const rak = attachment_info[R.recliner_attachment_key]||await EncryptionEngine.random_id();
                            attachment_info["rak"]=rak;
                            if(replicationInfo.lazy_headers){
                                let cloud_url = doc.attachments[attachment_name].cloud_url ?? Utils.build_path(sourceUrl,`/${docid}/${attachment_name}`);
                                doc.attachments[attachment_name].cloud_url=cloud_url;
                                attachment_info[R.cloud_url]=cloud_url;
                            }
                        }
                    }

                    let allGoodForDocPutting=true;

                    //TODO
                    //if old doc rev is later then the one received from remote then fetch a fresh request for the doc
                    let localDoc = await this.dbdaomap[targetDBName].read(R._id,doc._id);
                    if(localDoc && doc._rev!==localDoc._rev && !doc._deleted){
                        //local doc has been modified, which is not present at server yet
                        //lets fetch revisions of doc
                        let mvcc:MVCC=await this.getDocMVCCFromRemoteSource(sourceUrl,replicationInfo.source.headers,docid);
                        if(!mvcc){
                            allGoodForDocPutting=false;
                            replicationLogs.doc_write_failures++;
                        }else{
                            //lets override local MVCC with the one from server
                            if(!await this.dbdaomap[targetDBName].update(R._mvcc,doc._id,(oldObj)=>{
                                return {_id:doc._id,_revisions:mvcc};
                            })){
                                allGoodForDocPutting=false;
                                replicationLogs.doc_write_failures++;
                            }
                        }
                    }

                    if(allGoodForDocPutting){
                        //lets put this doc in target
                        const res = await this._put_the_doc(targetDBName,doc,doc._id,doc._rev,doc._rev,false);
                        if(res.status!=201){
                            //logs errors
                            replicationLogs.doc_write_failures++;
                        }else{
                            //lets check if this doc has attachment
                            if(doc._attachments && Object.keys(doc._attachments).length>0){
                                let attachmentFailure=false;
                                if(!replicationInfo.lazy_headers){
                                    for(let attachment_name of Object.keys(doc._attachments)){
                                        const attachment_info = doc.attachments[attachment_name];
                                        //this means we have attachments too
                                        const rak = attachment_info[R.recliner_attachment_key];
                                        if(!attachment_info[R.cloud_url]){
                                            //http://localhost:5984/mart_data/1bc11f92df41eca8e90dadebb797e72dc051175c/img.webp
                                            attachment_info[R.cloud_url]=Utils.build_path(replicationInfo.source.url,`/${doc._id}/${attachment_name}`);
                                        }
                                        const r2 = await fetch(attachment_info[R.cloud_url],{
                                            method:"GET",
                                            headers: replicationInfo.source.headers
                                        });
                                        if(r2.status!==200){
                                            console.warn(r2.status, r2.statusText,await r2.text(), `No attachment found at source: ${attachment_info[R.cloud_url]}`);
                                            attachmentFailure= true;
                                        }else{
                                            const blob = await r2.blob();
                                            if(!await this.dbdaomap[targetDBName].updateItemWithKey(R._attachments,rak,blob)){
                                                //log doc failures
                                                attachmentFailure= true;
                                                break;
                                            }
                                        }
                                    }
                                }
                                if(attachmentFailure){
                                    replicationLogs.doc_write_failures++;
                                }else{
                                    replicationLogs.docs_written++;
                                    totalWriteCounts++;
                                }
                            }else{
                                replicationLogs.docs_written++;
                                totalWriteCounts++;
                            }
                        }


                    }
                }
                
                
            }
            
            replicationLogs.end_time= new Date().getTime();

            //#############


            let newSourceRepLogs = sourceRepLogs.source_last_seq === "0"?true:false;
            let newTargetRepLogs = targetRepLogs.source_last_seq === "0"?true:false;

            //lets update this logs in replogs of source and target.
            sourceRepLogs.source_last_seq=end_seq;
            targetRepLogs.source_last_seq=end_seq;
            sourceRepLogs.history.unshift(replicationLogs);
            //This will ensure that local docs don't keep growing and only a limited rep logs be allowed per _local doc
            sourceRepLogs.history=sourceRepLogs.history.slice(0,R.max_rep_logs_history);

            //lets put this in both source and target
            //########## this step will be different for other cases
            let targetLog = {...sourceRepLogs,_id:replication_id};
            let isTarLogsUpdated = await this.dbdaomap[targetDBName].update(R._local,replication_id,(doc)=>targetLog,targetLog);

            const putLogsToSource = await fetch(Utils.build_path(sourceUrl,`/_local/${replication_id}`),{
                method: "PUT",
                headers: Utils.combine_headers(replicationInfo.source.headers,{"Content-Type":"application/json"}),
                body: JSON.stringify(sourceRepLogs)
            })
            let  isSrcLogsUpdated= putLogsToSource.status===201;

            if(!isSrcLogsUpdated){
                console.warn(putLogsToSource.status,putLogsToSource.statusText ,await putLogsToSource.text());
            }
            
            if(!(isSrcLogsUpdated && isTarLogsUpdated)){
                throw `Unable to save rep logs to _local objectStore`;
            }

            
            responseJson.history[0].docs_read+=replicationLogs.docs_read;
            responseJson.history[0].docs_written+=replicationLogs.docs_written;
            responseJson.history[0].end_last_seq=replicationLogs.end_last_seq;
            responseJson.history[0].end_time=replicationLogs.end_time;
            responseJson.history[0].recorded_seq=replicationLogs.recorded_seq;
            
            
            responseJson.ok = responseJson.history[0].docs_read === responseJson.history[0].docs_written;

            start_seq=replicationLogs.end_last_seq;

            }else{
                start_seq=end_seq;
            }
 
        }
        responseJson.history[0].doc_write_failures=responseJson.history[0].docs_read-responseJson.history[0].docs_written;
        return Utils.sendJsonResponse(responseJson,200);
    }



    private async replicateLocalToLocal(replication_id:string, session_id: string, replicationInfo:ReplicationInfoJSON):Promise<Response>{
        //get dbname
        const sourceDBName = this.uriEngine.getDBNameForLocalDB(replicationInfo.source.url);
        const targetDBName = this.uriEngine.getDBNameForLocalDB(replicationInfo.target.url);

        if(!(sourceDBName && targetDBName)){
            return Utils.sendOnlyStatus(400,"Check Url for source and target, no DB name can be derived from it. The should be of form /recliner/dbname");
        }

        //check if both DB exist
        if(!this.dbdaomap[sourceDBName]){
            return Utils.sendOnlyStatus(404,"Check if source DB exists.");
        }
        
        //check if target DB exist, it will create a local DB if it do not exist
        if(!this.dbdaomap[targetDBName]){
            //@ts-ignore
            const createTargetDB = await this.PUT_A_NEW_DB({path_params:{"db":targetDBName}});
            if(createTargetDB.status!==201){
                throw `Cannot create Target DB: ${targetDBName}`;
            }
        }

        //lets get DB update sequence
        const sourceDB_update_seq = await this.getDBUpdateSeq(sourceDBName);
        if(sourceDB_update_seq === "0"){
            return this._sendResponseIfLocalSourceDBHasNoChange(session_id);
        }
        //let end_seq be same as sourcedb update seq, we will set it to last-seq from change for selector and docIDs for respective cases
        let end_seq:string=sourceDB_update_seq;

        //get replication logs from source and target
        const sourceRepLogs:RepLogs = await this.getReplicationLogsForLocalDB(sourceDBName,replication_id)||this.getFreshRepLogs(replication_id,session_id);
        const targetRepLogs:RepLogs = await this.getReplicationLogsForLocalDB(targetDBName,replication_id)||this.getFreshRepLogs(replication_id,session_id);

        //finding start_seq
        let start_seq:string="0";
        //lets compare last_session_id of both source and target
        if((sourceRepLogs.last_session_id === targetRepLogs.last_session_id) || (sourceRepLogs.source_last_seq === "0")){
            start_seq=sourceRepLogs.source_last_seq;
        }else{
            const srcSessionIdMap=sourceRepLogs.history.reduce((p:RepLogsHistory,c:RepLogsHistory)=>{
                if(!(p as any)[c.session_id]){
                    (p as any)[c.session_id]=[];
                }
                (((p as any)[c.session_id]) as Array<string>).push(c.recorded_seq);
                return p;
            //@ts-ignore
            },{})
            
            const targetSessionIdMap=targetRepLogs.history.reduce((p:RepLogsHistory,c:RepLogsHistory)=>{
                if(!(p as any)[c.session_id]){
                    (p as any)[c.session_id]=[];
                }
                (((p as any)[c.session_id]) as Array<string>).unshift(c.recorded_seq);
                return p;
            //@ts-ignore
            },{})

            for(let session_id of Object.keys(targetSessionIdMap)){
                //@ts-ignore
                if(srcSessionIdMap[session_id] && (srcSessionIdMap[session_id] as Array).length>0){
                    //session id is present in both source and target.
                    //@ts-ignore
                    start_seq = (srcSessionIdMap[session_id] as Array<string>)[0];
                    //here we have used 0 as in history the rep logs are added by unshift, tha is added to history array from top.
                    break;
                }
            }
        }

        let bookmark:string;
        let limit:number= this.replication_bulk_doc_limit;

        let startTime = new Date().getTime();
        let session_start_seq = start_seq;
        let responseJson: ReplicationResponseJSON=this.getFreshReplicationResponseJSON(session_id,end_seq);

        responseJson.history[0].session_id=session_id;
        responseJson.history[0].start_last_seq=session_start_seq;
        responseJson.history[0].start_time=startTime;

        responseJson.replication_id_version=_replication_version;
        responseJson.session_id=session_id;
        responseJson.source_last_seq=end_seq;

        while(true){ 
             //loop breaking in
             if(start_seq === end_seq){
                break;
            }
            
            let replicationLogs:RepLogsHistory=this.getAFreshRepLogsHistory(session_id);

            let findDocs:FindResult;
            //we have start_seq now
            //lets get changes from source
            //lets see if we have selector or docids
            let srcChangeReqJson: ChangeReqJson;
            if(replicationInfo.doc_ids){
                srcChangeReqJson = await this.getChangeReqJsonForDocIDs(sourceDBName,replicationInfo.doc_ids,bookmark);
                
                //setting end_seq
                end_seq=srcChangeReqJson.last_seq;
            }else if(replicationInfo.selector){
                findDocs = await this.dbdaomap[sourceDBName].find({dbname: R._id,selector: replicationInfo.selector,limit,bookmark});//R._id,replicationInfo.selector,undefined,limit,0,bookmark);
                const docIds:string[] = findDocs.docs.map(e=>e._id);
                srcChangeReqJson = await this.getChangeReqJsonForDocIDs(sourceDBName,docIds,bookmark);

                //setting end_seq
                end_seq=srcChangeReqJson.last_seq;
            }else{
                srcChangeReqJson =await this.getChangeReqJsonForRange(sourceDBName,start_seq,limit,bookmark);
            }

            replicationLogs.start_last_seq=start_seq;
            replicationLogs.end_last_seq=srcChangeReqJson.last_seq;

            //########## this step can be ignored for remote source
            let changeReqJson: ChangeReqJson = this.convertChangeReqJsonToLatestDocChanges(srcChangeReqJson);

            //lets get latest rev of docs from target
            let revDiffRes:RevDiffRes= await this.getRevDiffFromLocalTarget(targetDBName,changeReqJson);

            //now we have got the list of docs missing and there rev
            //we need to determine if doc is design or normal doc
            let docIds:string[]=Object.keys(revDiffRes);
            let origOrderDocIds = docIds;

            //########## this step can be ignored for remote source
            //segregate between design docs and normal docs
            const designDocIDs:string []=[];
            docIds=[];
            Object.keys(revDiffRes).forEach(id=>{
                if(id.startsWith("_design/")){
                    designDocIDs.push(id);
                }else{
                    docIds.push(id);
                }
            });

            //lets bulk get docs
            const bulk_doc_result:FindResult = await this.dbdaomap[sourceDBName].find({dbname:R._id,selector:{_id:{$in:docIds}}});//R._id,{_id:{$in:docIds}},undefined);
            const docs: FlattenObject[] = bulk_doc_result.docs;

            const bulk_design_result:FindResult = await this.dbdaomap[sourceDBName].find({dbname: R._design,selector:{_id:{$in:designDocIDs}}});//R._design,{_id:{$in:designDocIDs}},undefined);
            docs.unshift(...bulk_design_result.docs);
            let docsMap = docs.reduce((p,c)=>{
                p[c._id]=c;
                return p;
            },{});

            replicationLogs.docs_read=docs.length;

            //lets iterate through them and process them, check if they have attachments
            for(let docid of origOrderDocIds){
                let doc = docsMap[docid];
                if(docid.startsWith("_design/")){
                    //lets put this doc in target
                    const res = await this._put_the_design(targetDBName,doc as Design,false);
                    if(res.status!=201){
                        //logs errors
                        replicationLogs.doc_write_failures++;
                    }else{
                        replicationLogs.docs_written++;
                    }
                }else{
                    //lets put this doc in target
                    const res = await this._put_the_doc(targetDBName,doc,doc._id,doc._rev,doc._rev,false);
                    if(res.status!=201){
                        //logs errors
                        replicationLogs.doc_write_failures++;
                    }else{
                        //lets check if this doc has attachment
                        if(doc._attachments && Object.keys(doc._attachments).length>0){
                            let attachmentFailure=false;
                            for(let attachment_name of Object.keys(doc._attachments)){
                                const attachment_info = doc._attachments[attachment_name];
                                //this means we have attachments too
                                const rak = attachment_info[R.recliner_attachment_key];
                                const blob = await this.dbdaomap[sourceDBName].read(R._attachments,rak);
                                if(!await this.dbdaomap[targetDBName].updateItemWithKey(R._attachments,rak,blob)){
                                    //log doc failures
                                    attachmentFailure= true;
                                    break;
                                }
                            }
                            if(attachmentFailure){
                                replicationLogs.doc_write_failures++;
                            }else{
                                replicationLogs.docs_written++;
                            }
                        }else{
                            replicationLogs.docs_written++;
                        }
                    }
                }
                
                
            }
            
            replicationLogs.end_time= new Date().getTime();

            let newSourceRepLogs = sourceRepLogs.source_last_seq === "0"?true:false;
            let newTargetRepLogs = targetRepLogs.source_last_seq === "0"?true:false;

            //lets update this logs in replogs of source and target.
            sourceRepLogs.source_last_seq=end_seq;
            targetRepLogs.source_last_seq=end_seq;
            sourceRepLogs.history.unshift(replicationLogs);

            //lets put this in both source and target
            //########## this step will be different for other cases
            let targetLog = {...sourceRepLogs,_id:replication_id};
            let isTarLogsUpdated = await this.dbdaomap[targetDBName].update(R._local,replication_id,(doc)=>targetLog,targetLog);
            let isSrcLogsUpdated = await this.dbdaomap[sourceDBName].update(R._local,replication_id,(doc)=>targetLog,targetLog);
            //let isSrcLogsUpdated = newSourceRepLogs?await this.dbdaomap[sourceDBName].create(R._local,sourceRepLogs):await this.dbdaomap[sourceDBName].update(R._local,replication_id,(doc)=>sourceRepLogs);
            // let isTarLogsUpdated = newTargetRepLogs?await this.dbdaomap[targetDBName].create(R._local,sourceRepLogs):await this.dbdaomap[targetDBName].update(R._local,replication_id,(doc)=>sourceRepLogs);

            if(!(isSrcLogsUpdated && isTarLogsUpdated)){
                throw `Unable to save rep logs to _local objectStore`;
            }

            responseJson.history[0].doc_write_failures+=replicationLogs.doc_write_failures;
            responseJson.history[0].docs_read+=replicationLogs.docs_read;
            responseJson.history[0].docs_written+=replicationLogs.docs_written;
            responseJson.history[0].end_last_seq=replicationLogs.end_last_seq;
            responseJson.history[0].end_time=replicationLogs.end_time;
            responseJson.history[0].recorded_seq=replicationLogs.recorded_seq;
            
            
            responseJson.ok = responseJson.history[0].docs_read === responseJson.history[0].docs_written;

            start_seq=replicationLogs.end_last_seq;
        }

        return Utils.sendJsonResponse(responseJson,200);
    }


    /**
     * 
     * @param replication_id 
     * @param session_id 
     * @param replicationInfo 
     */
    private async replicateLocalToRemote(replication_id:string, session_id: string, replicationInfo:ReplicationInfoJSON):Promise<Response>{
        //get dbname
        const sourceDBName = this.uriEngine.getDBNameForLocalDB(replicationInfo.source.url);
        const targetUrl = replicationInfo.target.url;

        if(!(sourceDBName)){
            return Utils.sendOnlyStatus(400,"Check Url for source, no DB name can be derived from it. The should be of form /recliner/dbname");
        }

        //check if source DB exist, it assumes target remote DB exist as it is something server has to cater.
        if(!this.dbdaomap[sourceDBName]){
            return Utils.sendOnlyStatus(404,"Check if source DB exists.");
        }

        const sourceDB_update_seq = await this.getDBUpdateSeq(sourceDBName);
        if(sourceDB_update_seq === "0"){
            return this._sendResponseIfLocalSourceDBHasNoChange(session_id);
        }
        //let end_seq be same as sourcedb update seq, we will set it to last-seq from change for selector and docIDs for respective cases
        let end_seq:string=sourceDB_update_seq;

        //get replication logs from source and target
        const sourceRepLogs:RepLogs = await this.getReplicationLogsForLocalDB(sourceDBName,replication_id)||this.getFreshRepLogs(replication_id,session_id);
        const targetRepLogs:RepLogs = await this.getReplicationLogsForRemoteDB(targetUrl,replication_id, replicationInfo.target.headers)||this.getFreshRepLogs(replication_id,session_id);
        //TODO only allow history of size 100, else doc will grow infinitely big

        //finding start_seq
        let start_seq:string="0";
        //lets compare last_session_id of both source and target
        if((sourceRepLogs.last_session_id === targetRepLogs.last_session_id) || (sourceRepLogs.source_last_seq === "0")){
            let actualStartSeq:string;
            for(let h of sourceRepLogs.history){
                if(h.doc_write_failures!==0){
                    actualStartSeq="0";
                    continue;
                }else{
                    actualStartSeq=h.end_last_seq;
                }
            }
            start_seq=actualStartSeq||sourceRepLogs.source_last_seq;
        }else{
            const srcSessionIdMap=sourceRepLogs.history.reduce((p:RepLogsHistory,c:RepLogsHistory)=>{
                if(!(p as any)[c.session_id]){
                    (p as any)[c.session_id]=[];
                }
                (((p as any)[c.session_id]) as Array<string>).push(c.recorded_seq);
                return p;
            //@ts-ignore
            },{})
            
            const targetSessionIdMap=targetRepLogs.history.reduce((p:RepLogsHistory,c:RepLogsHistory)=>{
                if(!(p as any)[c.session_id]){
                    (p as any)[c.session_id]=[];
                }
                (((p as any)[c.session_id]) as Array<string>).unshift(c.recorded_seq);
                return p;
            //@ts-ignore
            },{})

            for(let session_id of Object.keys(targetSessionIdMap)){
                //@ts-ignore
                if(srcSessionIdMap[session_id] && (srcSessionIdMap[session_id] as Array).length>0){
                    //session id is present in both source and target.
                    //@ts-ignore
                    start_seq = (srcSessionIdMap[session_id] as Array<string>)[0];
                    //here we have used 0 as in history the rep logs are added by unshift, tha is added to history array from top.
                    break;
                }
            }
        }

        let bookmark:string;
        let limit:number= this.replication_bulk_doc_limit;

        let startTime = new Date().getTime();
        let session_start_seq = start_seq;
        let responseJson: ReplicationResponseJSON=this.getFreshReplicationResponseJSON(session_id,end_seq);

        responseJson.history[0].session_id=session_id;
        responseJson.history[0].start_last_seq=session_start_seq;
        responseJson.history[0].start_time=startTime;

        responseJson.replication_id_version=_replication_version;
        responseJson.session_id=session_id;
        responseJson.source_last_seq=end_seq;

        while(true){ 
             //loop breaking in
             if(start_seq === end_seq){
                break;
            }
            
           
            let findDocs:FindResult;
            //we have start_seq now
            //lets get changes from source
            //lets see if we have selector or docids
            let srcChangeReqJson: ChangeReqJson;
            if(replicationInfo.doc_ids){
                srcChangeReqJson = await this.getChangeReqJsonForDocIDs(sourceDBName,replicationInfo.doc_ids,bookmark);
                
                //setting end_seq
                end_seq=srcChangeReqJson.last_seq;
            }else if(replicationInfo.selector){
                findDocs = await this.dbdaomap[sourceDBName].find({dbname: R._id,selector: replicationInfo.selector,limit,bookmark});//R._id,replicationInfo.selector,undefined,limit,0,bookmark);
                const docIds:string[] = findDocs.docs.map(e=>e._id);
                srcChangeReqJson = await this.getChangeReqJsonForDocIDs(sourceDBName,docIds,bookmark);

                //setting end_seq
                end_seq=srcChangeReqJson.last_seq;
            }else{
                srcChangeReqJson =await this.getChangeReqJsonForRange(sourceDBName,start_seq,limit,bookmark);
            }

            

            //########## this step can be ignored for remote source
            let changeReqJson: ChangeReqJson = this.convertChangeReqJsonToLatestDocChanges(srcChangeReqJson);

            //lets get latest rev of docs from target
            let revDiffRes:RevDiffRes= await this.getRevDiffFromRemoteTarget(targetUrl,changeReqJson, Utils.combine_headers(replicationInfo.target.headers,{
                "Content-Type":"application/json",
            }));

            //now we have got the list of docs missing and there rev
            //we need to determine if doc is design or normal doc
            let docIds:string[]=Object.keys(revDiffRes);
            let origOrderDocIds = docIds;

            //########## this step can be ignored for remote source
            //segregate between design docs and normal docs
            const designDocIDs:string []=[];
            docIds=[];
            Object.keys(revDiffRes).forEach(id=>{
                if(id.startsWith("_design/")){
                    designDocIDs.push(id);
                }else{
                    docIds.push(id);
                }
            });

            //lets bulk get docs from source 
            const bulk_doc_result:FindResult = await this.dbdaomap[sourceDBName].find({dbname: R._id,selector:{_id:{$in:docIds}}});//(R._id,{_id:{$in:docIds}},undefined);
            const docs: FlattenObject[] = bulk_doc_result.docs;

            //by default design docs will not be replicated
            if(replicationInfo.replicate_design){
                const bulk_design_result:FindResult = await this.dbdaomap[sourceDBName].find({dbname: R._design,selector:{_id:{$in:designDocIDs}}});//(R._design,{_id:{$in:designDocIDs}},undefined);
                docs.unshift(...bulk_design_result.docs);
            }
            

            /**
             * This is full and final rep logs
             */
            let replicationLogs:RepLogsHistory=this.getAFreshRepLogsHistory(session_id);

            if(docs.length>0){
                let replicationLogsForDoc:RepLogsHistory = await this._putTheseLocalDocsToRemote({
                    last_seq:srcChangeReqJson.last_seq,
                    session_id,
                    sourceDBName,
                    start_seq,
                    targetUrl,
                    headers:Utils.combine_headers(replicationInfo.target.headers,{"Content-Type":"application/json"}),
                    docs,
                    lazy_headers: replicationInfo.lazy_headers
                });

                replicationLogs.doc_write_failures+=replicationLogsForDoc.doc_write_failures;
                replicationLogs.docs_read+=replicationLogsForDoc.docs_read;
                replicationLogs.docs_written+=replicationLogsForDoc.docs_written;
                replicationLogs.end_last_seq=replicationLogsForDoc.end_last_seq;
                replicationLogs.end_time=replicationLogsForDoc.end_time;
                replicationLogs.recorded_seq=replicationLogsForDoc.recorded_seq;
                replicationLogs.session_id=replicationLogsForDoc.session_id;
                replicationLogs.start_last_seq=replicationLogsForDoc.start_last_seq;
                replicationLogs.start_time=replicationLogsForDoc.start_time;
            }else{
                replicationLogs.end_last_seq=changeReqJson.last_seq;
            }
            

            let newSourceRepLogs = sourceRepLogs.source_last_seq === "0"?true:false;
            let newTargetRepLogs = targetRepLogs.source_last_seq === "0"?true:false;

            //lets update this logs in replogs of source and target.
            sourceRepLogs.source_last_seq=end_seq;
            targetRepLogs.source_last_seq=end_seq;
            sourceRepLogs.history.unshift(replicationLogs);
            //This will ensure that local docs don't keep growing and only a limited rep logs be allowed per _local doc
            sourceRepLogs.history=sourceRepLogs.history.slice(0,R.max_rep_logs_history);

            //lets put this in both source and target
            //########## this step will be different for other cases
            //let isSrcLogsUpdated = newSourceRepLogs?await this.dbdaomap[sourceDBName].create(R._local,sourceRepLogs):await this.dbdaomap[sourceDBName].update(R._local,replication_id,(doc)=>sourceRepLogs);
            let sourceLog = {...sourceRepLogs,_id:replication_id};
            let isSrcLogsUpdated = await this.dbdaomap[sourceDBName].update(R._local,replication_id,(doc)=>sourceLog,sourceLog);
            const putLogsToTarget = await fetch(Utils.build_path(targetUrl,`/_local/${replication_id}`),{
                method: "PUT",
                headers: Utils.combine_headers(replicationInfo.target.headers,{"Content-Type":"application/json"}),
                body: JSON.stringify(sourceRepLogs)
            })
            let isTarLogsUpdated = putLogsToTarget.status===201;

            if(!isTarLogsUpdated){
                console.log(await putLogsToTarget.text());
            }
            
            if(!(isSrcLogsUpdated && isTarLogsUpdated)){
                throw `Unable to save rep logs to _local objectStore`;
            }

            responseJson.history[0].doc_write_failures+=replicationLogs.doc_write_failures;
            responseJson.history[0].docs_read+=replicationLogs.docs_read;
            responseJson.history[0].docs_written+=replicationLogs.docs_written;
            responseJson.history[0].end_last_seq=replicationLogs.end_last_seq;
            responseJson.history[0].end_time=replicationLogs.end_time;
            responseJson.history[0].recorded_seq=replicationLogs.recorded_seq;
            
            
            responseJson.ok = responseJson.history[0].docs_read === responseJson.history[0].docs_written;

            start_seq=replicationLogs.end_last_seq;
            if(docs.length===0 && changeReqJson.results.length===0){
                start_seq=end_seq;
            }

        }

        return Utils.sendJsonResponse(responseJson,200);
    }

    private checkIfDocHasAttachments(doc:FlattenObject){
        return doc._attachments && Object.keys(doc._attachments).length>0;
    }

    private async _putTheseLocalDocsToRemote(info:{
        sourceDBName:string,
        targetUrl:string,
        headers: HttpHeader,
        session_id:string,
        start_seq:string,
        /**
         * srcChangeReqJson.last_seq;
         */
        last_seq:string,
        docs:FlattenObject[],
        lazy_headers: HttpHeader
    }){
        let replicationLogs:RepLogsHistory=this.getAFreshRepLogsHistory(info.session_id);
            replicationLogs.start_last_seq=info.start_seq;
            replicationLogs.end_last_seq=info.last_seq;
            replicationLogs.docs_read=info.docs.length;
            

            for(let doc of info.docs){
                //removing all _local changes: A field _local is present on doc is removed from doc before replication
                if(doc.hasOwnProperty(R._local)){
                    delete doc[R._local];
                }

                //while bulk docs upload an entry of _revisions is to be made for replicating deleted docs and aligning MVCC
                {
                    let getMVCCForDoc=await this.dbdaomap[info.sourceDBName].read(R._mvcc,doc[R._id]);
                    doc._revisions=getMVCCForDoc._revisions;
                }
                if(this.checkIfDocHasAttachments(doc)){
                    //remove those attachments which has cloud url present, as the receiving client can always download them from cloud
                    for(let attachment_name in doc.attachments){
                        if(doc.attachments[attachment_name][R.cloud_url]  && doc._attachments[attachment_name]){
                            delete doc._attachments[attachment_name];
                        }
                    }

                    if(doc._attachments){
                        //this attachments are all which has no cloud url and are present locally too
                        for(let attachment_name of Object.keys(doc._attachments)){
                            const attachment_info = doc._attachments[attachment_name];
                            const rak = attachment_info[R.recliner_attachment_key];
                            let blob:Blob = await this.dbdaomap[info.sourceDBName].read(R._attachments,rak);
                            if(blob){
                                doc._attachments[attachment_name].data=await Utils.blobToBase64(blob);
                                doc._attachments[attachment_name].stub=false;
                            }
                        }
                    }
                    
                }
            }


             //bulk request
            const reqBody : BulkDocRequestBody = {
                docs:info.docs,
                new_edits:false
            }
            const res = await fetch(Utils.build_path(info.targetUrl,"/_bulk_docs"),{
                method: "POST",
                headers:Utils.combine_headers(info.headers,{"Content-Type":"application/json"}),
                body: JSON.stringify(reqBody)
            });
            if(res.status!==201){
                console.log(res.status," ",await res.text());
                replicationLogs.doc_write_failures+=info.docs.length
            }else{
                const bulkDocResponse: DBPutResponse[]=await res.json();
                
                for(let r of bulkDocResponse){
                    if(r.error){
                        console.error(r.error," : ", r.reason);
                        replicationLogs.doc_write_failures++;
                    }
                }
                replicationLogs.docs_written=replicationLogs.docs_read-replicationLogs.doc_write_failures;
            }
            
            replicationLogs.end_time= new Date().getTime();
            return replicationLogs;
    }

    private getFreshReplicationResponseJSON(session_id:string, source_last_seq:string):ReplicationResponseJSON{
        return {
            history:[this.getAFreshRepLogsHistory(session_id)],
            ok:true,
            replication_id_version: _replication_version,
            session_id,
            source_last_seq
        };
    }

    private getFreshRepLogs(replication_id:string, session_id:string): RepLogs{
        return {
            _id:replication_id,
            _rev:"0-1",
            replication_id_version:_replication_version,
            last_session_id:session_id,
            source_last_seq:"0",
            history:[]
        };
    }

    private getAFreshRepLogsHistory(session_id:string):RepLogsHistory{
        let t = new Date().getTime();
        return {
            doc_write_failures:0,
            docs_read:0,
            docs_written:0,
            end_last_seq:"0",
            start_last_seq:"0",
            end_time:t,
            start_time:t,
            recorded_seq:"0",
            session_id
        }
    }

    private async getRevDiffFromRemoteTarget(targetUrl:string,changeReqJson: ChangeReqJson, headers:HttpHeader):Promise<RevDiffRes>{
        let initValue: RevDiffReq={};
        const revDiffReq:RevDiffReq=changeReqJson.results.reduce((p,c)=>{
            p[c.id]=[c.changes[0].rev];
            return p;
        },initValue);
        const res = await fetch(Utils.build_path(targetUrl,"/_revs_diff"),{
            method: "POST",
            headers:headers,
            body: JSON.stringify(revDiffReq)
        });
        if(res.status===200){
            const r:RevDiffRes = await res.json();
            return r;
        }else{
            throw `${res.status}: ${res.statusText}`;
        }
    }

    private async getRevDiffFromLocalTarget(targetDBName:string,changeReqJson: ChangeReqJson):Promise<RevDiffRes>{
        let initValue: RevDiffReq={};
        const revDiffReq:RevDiffReq=changeReqJson.results.reduce((p,c)=>{
            p[c.id]=[c.changes[0].rev];
            return p;
        },initValue);
        
        //########## these step will be different if target is remote
        let revDiffRes:RevDiffRes={};
        for(let id of Object.keys(revDiffReq)){
            const doc = await this.dbdaomap[targetDBName].read(R._id,id);
            if(!doc){
                revDiffRes[id]={missing:[revDiffReq[id][0]]}
            }else if(doc._rev !== revDiffReq[id][0]){
                revDiffRes[id]={missing:[revDiffReq[id][0]]}
            }
        }
        return revDiffRes;
    }

    private convertChangeReqJsonToLatestDocChanges(changeReqJson: ChangeReqJson):ChangeReqJson{
        //here we ensure only latest change for a doc is captured
        const initValue:Record<string,ChangeDoc>={};
        const r1:Record<string,ChangeDoc> = changeReqJson.results.reduce((p,c)=>{
            p[c.id]=c;
            return p;
        },initValue);
        
        const result:ChangeDoc[] = [];
        for(let k of Object.keys(r1)){
            result.push(r1[k]);
        }

        return {last_seq:changeReqJson.last_seq,results:result};
    }

    /**
     * It was found that if a document is deleted locally, it would again come back if R2L is replicated, as the remote source would some time put a deleted doc as Branched doc (in a parallel branch because of MVCC)
     * @param sourcedburl 
     * @param headers 
     * @param docid 
     */
    private async getDocMVCCFromRemoteSource(sourcedburl:string,headers:HttpHeader,docid:string){
        const res = await fetch(Utils.build_path(sourcedburl,`/${docid}?revs=true`),{
            method:"GET",
            headers
        });
        if(res.status===200){
            let doc:DBDoc = await res.json();
            return doc._revisions;
        }
    }

    private async getRemoteSourceChangeReqJsonForRange(sourcedburl:string, headers: HttpHeader,pageData:PageData):Promise<ChangeReqJson>{
        const res = await fetch(Utils.build_path(sourcedburl,`/_changes?since=${pageData.since}&limit=${pageData.limit}`),{
            method:"GET",
            headers
        });
        if(res.status===200){
            return await res.json();
        }else{
            console.warn(res.status, res.statusText, await res.text());
        
            throw `Cannot fetch changes from remote server`;
        }
    }

    private async getChangeReqJsonForRange(dbname:string, since:string, limit:number, bookmark?:string):Promise<ChangeReqJson>{
        const _idForChange = parseInt(since.split("\-")[0]);
        let changedDocsRes = await this.dbdaomap[dbname].find({dbname: R._changes,selector:{_id:{$gt:_idForChange}},limit,bookmark});//(R._changes,{_id:{$gt:_idForChange}},undefined,limit,0,bookmark);
        if(changedDocsRes.docs.length==0){
            return {last_seq:"0",results:[]};
        }else{
            return {
                results: changedDocsRes.docs,
                last_seq: (changedDocsRes.docs[changedDocsRes.docs.length-1] as ChangeDoc).seq
            }
        }
    }

    private async getRemoteChangeReqJsonForSelector(sourcedburl:string,selector:FlattenObject,headers:HttpHeader,pageData:PageData):Promise<ChangeReqJson>{
        let limit:number=this.replication_bulk_doc_limit;
        let descending=false;
        if(pageData.limit){
            limit=pageData.limit;
            descending=true;
        }
        let t1 = await fetch(Utils.build_path(sourcedburl,`/_changes?filter=_selector`),{
            method:"POST",
            headers,
            body:JSON.stringify({
                selector, since:pageData.since,limit,descending})
        })
        if(t1.status===200){
            let changedDocsRes = await t1.json();
            if(changedDocsRes.results.length==0){
                return {last_seq:"0",results:[]};
            }else{
                return changedDocsRes;
            }
        }else{
            throw `Cannot fetch changes for ${sourcedburl}`;
        }
    }

    private async getDocIDsFromViewQuery(replicationInfo:ReplicationInfoJSON,headers:HttpHeader,srcChangeReqJson: ChangeReqJson, targetDBName:string):Promise<string[]>{
        if(!replicationInfo.selector){
            replicationInfo.selector={}
        }
        replicationInfo.selector.update_seq=true;

        let t1 = await fetch(replicationInfo.viewBasedReplication.remoteViewUrl,{
            method:"POST",
            headers,
            body:JSON.stringify(replicationInfo.selector)
        });
        if(t1.status === 200){
            const viewRes:{rows:ViewRow[],update_seq:string} = await t1.json();
            let rows:ViewRow[]=viewRes.rows;

            if(replicationInfo.viewBasedReplication?.viewResultFilterFunctions.length>0){
                const dbDesign:DBDesign = this._db_design_map[targetDBName];
                for(let vff of replicationInfo.viewBasedReplication.viewResultFilterFunctions){
                    const vfFunc = dbDesign.view_result_filter_functions[vff];
                    if(!vfFunc){
                        throw `View filter function :${vff} not found, in DB design for DB: ${targetDBName}`;
                    }
                    rows = await vfFunc({
                        direction:{
                            matched_pattern:undefined,
                            parent_matches:undefined,
                            path_params:{dbname:targetDBName}
                        }, recliner: this, req:undefined
                    },rows);
                }
            }

            const s = new Set<string>();
            rows.forEach(e=>{
                s.add(e.id);
            })
            srcChangeReqJson.last_seq=viewRes.update_seq;
            return Array.from(s);
        }else{
            throw `Cannot query remote view: ${replicationInfo.viewBasedReplication.remoteViewUrl}. selector query is:  ${JSON.stringify(replicationInfo.selector)}`;
        }
    }

    private async getRemoteChangeReqJsonForDocIDs(sourcedburl:string,docIds:string[],headers:HttpHeader,pageData:PageData):Promise<ChangeReqJson>{
        let t1 = await fetch(Utils.build_path(sourcedburl,`/_changes?filter=_doc_ids`),{
            method:"POST",
            headers,
            body:JSON.stringify({
                doc_ids: docIds,
                since: pageData.since,
                limit: this.replication_bulk_doc_limit
            })
        })
        if(t1.status===200){
            let changedDocsRes = await t1.json();
            if(changedDocsRes.results.length==0){
                return {last_seq:"0",results:[]};
            }else{
                // return {
                //     results: changedDocsRes.docs,
                //     last_seq: (changedDocsRes.docs[changedDocsRes.docs.length-1] as ChangeDoc).seq
                // }
                return changedDocsRes;
            }
        }else{
            throw `Cannot fetch changes for ${sourcedburl}`;
        }
    }

    private async getChangeReqJsonForDocIDs(dbname:string, docIds:string[],bookmark?:string):Promise<ChangeReqJson>{
        let changedDocsRes = await this.dbdaomap[dbname].find({dbname:R._changes,selector:{id:{$in:docIds}}});//(R._changes,{id:{$in:docIds}},undefined,this.replication_bulk_doc_limit,0,bookmark);
        if(changedDocsRes.docs.length==0){
            return {last_seq:"0",results:[]};
        }else{
            return {
                results: changedDocsRes.docs,
                last_seq: (changedDocsRes.docs[changedDocsRes.docs.length-1] as ChangeDoc).seq
            }
        }
    }

    private getReplicationLogsForLocalDB(dbname:string, replication_id:string):Promise<RepLogs>{
        return this.dbdaomap[dbname].read(R._local,replication_id);
    }

    private async getReplicationLogsForRemoteDB(remoteDBUrl: string,replication_id:string, remoteHeaders: HttpHeader):Promise<RepLogs>{
        const res = await fetch(Utils.build_path(remoteDBUrl,`/_local/${replication_id}`),{
            headers:remoteHeaders
        });
        if(res.status===200){
            const repLogs:RepLogs = await res.json();
            return repLogs;
        }
    }

    private _sendResponseIfLocalSourceDBHasNoChange(session_id: string):Response{
        const repLogsResponse: ReplicationResponseJSON ={
            ok:true,
            history:[],
            replication_id_version:_replication_version,
            session_id:session_id,
            source_last_seq:"0"
        }
        return Utils.sendJsonResponse(repLogsResponse,200);
    }

    private  async createAReplicationID(replicationInfo:ReplicationInfoJSON):Promise<string>{
        return await EncryptionEngine.sha1_hash(JSON.stringify(replicationInfo));
    }

}


