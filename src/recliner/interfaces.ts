import { PathDirection } from "./engines/compass";
import { DBDAOMap, Recliner } from "./recliner";
import { FlattenObject, FlattenSelector } from "./utils";

export interface Bookmark{
    /**
     * Last key used
     */
    key: IDBValidKey;

    /**
     * Primary key
     */
    primaryKey: IDBValidKey;
    /**
     * For example:
     * `{"some.flat.key":{$op: value}}`
     */
    mostEfficientIndex: FlattenSelector;
}

export interface MostEfficientIndex{
    mostEfficientIndex?: string;
    min_count?: number;
    no_match: boolean;
    index_range?: IDBKeyRange;
    key?: IDBValidKey;
}

export const DifferentRulesOperators = new Set<string>(["$in"]);//"$nin","$ne","$regex"

export interface DifferentOperatorInfo{
    index: string;
    op: string;
    value: any;
}

export interface Selector{
    [key:string]:any;
}

/**
 * If no selector or doc_ids is given then it goes for full replication.
 * If `doc_ids` and `selector` both are given then doc_ids is given preference over selector.
 */
export interface ReplicationInfoJSON{
    /**
     * Selector used for selecting documents which needs to replicated.
     */    
    selector?: FlattenObject;
    /**
     * Doc ids which needs to be replicated.
     */
    doc_ids?: string[];
    /**
     * Source DB whose data needs to be replicated to target DB.
     */
    source:DBInfoForReplication;
    /**
     * Target DB which needs same data as source DB.
     */
    target:DBInfoForReplication;
    /**
     * Has effect only for RemoteToLocal and LocalToRemote Replication.\
     * If present than attachment will not be download, right away instead it will be downloaded later.\
     * Attachment will save cloud_url instead, which will be same as sourceDbUrl/docid/attachmentId
     */
    lazy_headers?:HttpHeader;

    /**
     * By default design docs will not be replicated. Its because if wrongly replicated then it can cause massive performance down at remote DB due to continues index creation from different sources.
     */
    replicate_design?:boolean;

    /**
     * If greater than 0 for remote to local replication:/
     * 1. _change request will do descending update: Return the change results in descending sequence order (most recent change first).
     * 2. This will control the number of docs replicated. If doc_write_successfully >=limit, the replication will end.
     * 
     * This is useful specifically for pagination based replication, say pulling out 10 relies on a post, and then again when user clicks load more.
     */
    limit?:number;
    /**
     * Applicable only for remote to local replication: 
     * If provided then this will be used instead of change request for replication.
     * Selector will be all view based query parameters for POST kind of request for couchdb
     */
    viewBasedReplication?:{
        remoteViewUrl:string;
        viewResultFilterFunctions:string[];
    }
}

export interface DBInfoForReplication{
    url: string;
    headers?: HttpHeader;
}

export interface RepLogs{
    _id:string;
    _rev:string;
    replication_id_version:number;
    last_session_id:string;
    source_last_seq:string;
    history: RepLogsHistory[];
}

export interface RepLogsHistory{
    doc_write_failures:number;
    docs_read:number;
    docs_written:number;
    /**
     * Source last change seq
     */
    start_last_seq:string;
    /**
     * Target last change seq
     */
    end_last_seq: string;
    
    recorded_seq:string;
    /**
     * UTC time
     */
    start_time:number
    end_time:number;
    
    session_id: string;
    
}

export interface ReplicationResponseJSON{
ok:boolean;
replication_id_version: number;
session_id: string;
source_last_seq: string;
history: RepLogsHistory[];
}

export interface ChangeDoc{
    _id:string
    id:string;
    seq:string;
    changes:{rev:string}[]
    deleted?:boolean;
}

export interface ChangeReqJson{
    last_seq:string;
    results: ChangeDoc[];
}

export interface RevDiffReq{
    [id:string]:string[]
}

export interface RevDiffRes{
    [id:string]:{missing:string[]}
}

export interface HttpHeader{
    [key:string]:any
}

export interface BulkDocRequestBody{
    docs:FlattenObject[];
    new_edits:boolean;
}

export interface DBPutResponse{
    ok:boolean;
    error?:string;
    reason?:string;
    id:string;
    rev:string;
}


export interface CollectFunction{
    (value:any):void
}

export interface ReclinerRequestInfo{
    recliner:Recliner;
    direction: PathDirection, 
    req: Request
}

/**
 * Spread a single doc
 */
export interface MapFunction{
    (reclinerReqInfo:ReclinerRequestInfo,collect:CollectFunction,doc:any,data?:any):void;
}

/**
 * Reduce a doc
 */
export interface ReduceFunction{
    (reclinerReqInfo:ReclinerRequestInfo,collect:CollectFunction,docs:any[],data?:any):void;
}

/**
 * Can modify the doc too.
 * If returns a string that means doc is not valid and has failed due to following validation message;
 */
export interface DBDocValidationFunction{
    (reclinerReqInfo:ReclinerRequestInfo, doc:any, validation_before:"insert"|"update"|"delete"):string;
}

/**
 * If returns a value, then they are updated in DB, else does nothing.
 * Length of output docs needs not be necessarily same as found_docs.
 * It can be greater or smaller than found docs. So it can create new docs on fly or reject some docs for modifications.
 */
export interface DBDocUpdateFunction{
    (reclinerReqInfo:ReclinerRequestInfo,found_docs:DBDoc[], valueForModification:any):Promise<DBDoc[]>;
}

/**
 * Output can be more or less keys, and  even the data can be modified inside it
 */
export interface ViewResultFilterFunction{
    (reclinerReqInfo:ReclinerRequestInfo,viewRowsList:ViewRow[]):Promise<ViewRow[]>;
}

export interface RenderFunction{
    (prevResult:any,input_data?:any):Promise<{content_type:string,body:any}>
}

/**
 * Is configured on DB level.
 * Stored in _system DB.
 */
export interface DBDesign{
    /**
     * Can be used to validate insert,delete and update operation on a doc.
     */
    doc_validation_function?:DBDocValidationFunction;
    /**
     * Used to query db. Essentially part of map and reduce query pattern.
     */
    map_functions?:Record<string,MapFunction>;
    /**
     * Used to query db. Essentially part of map and reduce query pattern.
     */
    reduce_functions?:Record<string,ReduceFunction>;
    /**
     * Used to update document from recliner side.
     * It can be used to register standard update function at Recliner side.
     * It can be also used as validator.
     */
    update_functions?:Record<string,DBDocUpdateFunction>;
    
    /**
     * Used during remote to local replication.
     * R2L rep can be now done using View keys. This functions are used to filter the result of a view query.
     * View query can be passed using : remoteViewUrl in the ReplicationInfo document. Selector is used to pass the view query.
     * Views are only supported on remote system. Recliner do not have views yet.
     */
     view_result_filter_functions?:Record<string,ViewResultFilterFunction>;

     /**
      * For example is used to convert a query into an HTML document (or any other format instead of json)
      */
     render_functions?:Record<string,RenderFunction>;
}

export interface DBDesignDoc{
    for_db:string;
    doc_validation_function?:string;
    map_functions?: Record<string,string>;
    reduce_functions?:Record<string,string>;
    update_functions?:Record<string,string>;

    /**
     * Used during remote to local replication using view query as source. [one can pass viewQueryUrl to replication info, to start view based replication]
     * This functions are used to filter view result before replicating them to local DB.
     */
    view_result_filter_functions?:Record<string,string>;

    render_functions?:Record<string,string>;
}

export interface DBRunUpdateFunctionsRequest{
    /**
     * Used to select docs from DB, on which this update function will be applied.
     */
    selector:Selector,
    update_function_names:string[];
    valueForModification: any;
}

export interface MapReduceQuery{
    /**
     * Used to select docs from DB, on which map reduce will be applied later on.
     */
    selector:Selector,
    /**
     * applied on docs selected via selector
     */
    fields?:string[],
    /**
     * name of map and reduce functions defined in DB_design doc
     */
    map_reduce_queue:string[],
    data?:any;
}

export interface DBDocAttachmentInfo{
    rak:string;
    content_type:string;
    length: number;
    cloud_url?:string;
    stub?:boolean;
}

export interface DBDocAttachment{
    [key:string]:DBDocAttachmentInfo
}
export interface DBDoc{
    _id?:string;
    _rev?:string;
    _attachments?:DBDocAttachment;
    attachments?:DBDocAttachment;
    _local?:any;
    /**
     * if set as true, then doc is considered as deleted.
     * Do not set it to any value if you do not intend to delete this doc.
     */
    _deleted?:boolean;
    /**
     * Contains MVCC information
     */
    _revisions?:MVCC;
}

export interface MVCC{start:number,ids:string[]}

export interface ExecutionStats {
    total_keys_examined: number;
    total_docs_examined: number;
    execution_time_ms: number;
    results_returned: number;
    primary_index?:string;
}

export interface PageData{
    limit:number;
    since:string;
}

export interface ViewRow{
    id:string;
    key:any;
    value:any;
}