import { Compass, PathDirection } from "./compass";

class RECLINER_API_PATH{
    static RECLINER_INFO = "/recliner";
    static RECLINER_DELETE= "/recliner/_delete_recliner";
    static DB_BASE = "/recliner/:db";
    static DB_DESIGN = "/recliner/:db/_design/:ddoc";
    static DB_VIEW = "/recliner/:db/_design/:ddoc/_view/:view"
    static DB_FIND = "/recliner/:db/_find";
    static DB_INDEX = "/recliner/:db/_index";
    static DB_REPLICATE = "/recliner/_replicate";
    static DB_CHANGES = "/recliner/:db/_changes";
    static DB_BULK_GET = "/recliner/:db/_bulk_get";
    static DB_REV_DIFF = "/recliner/:db/_revs_diff";
    static DB_LOCAL_DOC = "/recliner/:db/_local/:docid";
    static DB_DOC_ID = "/recliner/:db/:docid";
    static DB_ATTACHMENT = "/recliner/:db/:docid/:attachment";
    static DB_DELETE_INDEX = "/recliner/:db/_index/:ddoc/json/:name";
    static DB_DB_DESIGN="/recliner/:db/_db_design";
    static DB_RUN_UPDATE_FUNCTIONS="/recliner/:db/_run_update_function";
}

class HttpMethod{
    static HEAD = "HEAD";
    static GET = "GET";
    static POST = "POST";
    static PUT = "PUT";
    static DELETE ="DELETE";
}

export enum Action {
    ///**GET /**
    GET_DBMS_INFO,
    ///**HEAD /{db}**
    CHECK_DB_EXISTENCE,
    ///**GET /{db}**
    GET_INFO_ABT_A_DB,
    ///**PUT /{db}**
    PUT_A_NEW_DB,
    ///**DELETE /{db}**
    DELETE_THE_DB,
    ///**POST /{db}**
    POST_A_NEW_DOC,
    ///**HEAD /{db}/{docid}**
    CHECK_DOC_EXISTENCE,
    ///**GET /{db}/{docid}**
    GET_THE_DOCUMENT,
    ///**PUT /{db}/{docid}**
    PUT_A_DOC,
    ///**DELETE /{db}/{docid}**
    DELETE_THE_DOC,
    ///**HEAD /{db}/_design/{ddoc}**
    CHECK_DESIGN_DOC_EXISTENCE,
    ///**GET /{db}/_design/{ddoc}**
    GET_THE_DESIGN_DOC,
    ///**PUT /{db}/_design/{ddoc}**
    PUT_A_DESIGN_DOC,
    ///**DELETE /{db}/_design/{ddoc}**
    DELETE_A_DESIGN_DOC,
    ///**GET /{db}/_design/{ddoc}/_view/{view}**
    GET_THE_RESULT_OF_VIEW,
    ///**POST /{db}/_design/{ddoc}/_view/{view}**
    POST_A_VIEW_QUERY,
    ///**HEAD /{db}/{docid}/{attname}**
    CHECK_ATTACHMENT_EXISTENCE,
    ///**GET /{db}/{docid}/{attname}**
    GET_ATTACHMENT_FOR_THE_DOC,
    ///**PUT /{db}/{docid}/{attname}**
    PUT_AN_ATTACHMENT_TO_THE_DOC,
    ///**DELETE /{db}/{docid}/{attname}**
    DELETE_THE_ATTACHMENT_OF_THE_DOC,
  
    ///**POST /_replicate
    REPLICATE,
  
    ///**GET /{db}/_changes**
    GET_CHANGE_FEED,
  
    ///**POST /{db}/_changes**
    POST_CHANGE_FEED,
  
  
    ///**/{db}/_revs_diff**
    POST_REVS_DIFF,
  
    ///No api present or not coded yet in this package
    CASE_DO_NOT_EXIST,
  
    CREATE_INDEX,
  
    DELETE_INDEX,
  
    CHECK_INDEX,
  
    /**
     * Use to search for docs
     */
    FIND_IN_INDEX,
  
  
    BULK_GET,

    CHECK_LOCAL_DOC,
    GET_LOCAL_DOC,
    PUT_A_LOCAL_DOC,
    DELETE_A_LOCAL_DOC,

    /**
     * Contains validation, map and reduce function
     */
    PUT_DB_DESIGN,
    QUERY_DB_DESIGN,
    CHECK_DB_DESIGN,

    /**
     * Will delete every database managed by recliner
     * DELETE /recliner/_delete_recliner
     */
     RECLINER_DELETE,

     /**
      * Will run update function on DB Doc
      */
     RUN_UPDATE_FUNCTIONS
  }

export class URIEngine{
    private compass: Compass;

    constructor(){
        this.compass = new Compass();
        this._init();
    }

    private _init(){
        try{
            if(!this._setupDBApiPaths()){
                throw `Failed to setup recliner DB api paths`;
            }

            return true;
        }catch(e){
            console.error("Failed to initialize recliner!");
            console.error(e);
            return false;
        }
    }

     
    private set define(v : string) {
        this.compass.define(v);
    }
    

    private _setupDBApiPaths(): boolean{

        this.define = RECLINER_API_PATH.RECLINER_INFO;
        this.define = RECLINER_API_PATH.DB_BASE
        this.define = RECLINER_API_PATH.DB_DESIGN
        this.define = RECLINER_API_PATH.DB_VIEW
        this.define = RECLINER_API_PATH.DB_FIND
        this.define = RECLINER_API_PATH.DB_INDEX
        this.define = RECLINER_API_PATH.DB_REPLICATE
        this.define = RECLINER_API_PATH.DB_CHANGES
        this.define = RECLINER_API_PATH.DB_BULK_GET
        this.define = RECLINER_API_PATH.DB_REV_DIFF
        this.define = RECLINER_API_PATH.DB_LOCAL_DOC
        this.define = RECLINER_API_PATH.DB_DOC_ID
        this.define = RECLINER_API_PATH.DB_ATTACHMENT
        this.define = RECLINER_API_PATH.DB_DELETE_INDEX
        this.define = RECLINER_API_PATH.DB_DB_DESIGN
        this.define = RECLINER_API_PATH.RECLINER_DELETE
        this.define = RECLINER_API_PATH.DB_RUN_UPDATE_FUNCTIONS

        return true;
    }

    public getDBNameForLocalDB(localUrl:string):string{
        const pd:PathDirection = this.compass.find(localUrl);
        if(pd){
            return pd.path_params["db"];
        }
    }
    
    /**
     * 
     * @param req 
     */
    public identifyTheAction(url_path: string, method: string): URIEngineResult{
        const r = this.compass.find(url_path);
        if(r){
            const l = r.matched_pattern.split("/");

            switch(l.length){
                case 2:{
                    switch(method){
                        case HttpMethod.GET:{
                            if(r.matched_pattern === RECLINER_API_PATH.RECLINER_INFO){
                                return {action:Action.GET_DBMS_INFO, direction: r};
                            }
                            break;
                        }
                        default:
                            return {action:Action.CASE_DO_NOT_EXIST, direction: r};
                    }
                }
                case 3: {
                    switch(method){
                        case HttpMethod.HEAD:{
                            if(r.matched_pattern === RECLINER_API_PATH.DB_BASE){
                                return {
                                    action: Action.CHECK_DB_EXISTENCE,
                                    direction: r
                                };
                            }
                            break;
                        }
                        case HttpMethod.GET:{
                            if(r.matched_pattern === RECLINER_API_PATH.RECLINER_INFO){
                                return {action:Action.GET_DBMS_INFO, direction: r};
                            }else if(r.matched_pattern === RECLINER_API_PATH.DB_BASE){
                                return {action:Action.GET_INFO_ABT_A_DB, direction: r};
                            }
                            break;
                        }
                        case HttpMethod.POST:{
                            if(r.matched_pattern === RECLINER_API_PATH.DB_REPLICATE){
                                return {action:Action.REPLICATE, direction: r}
                            }else if(r.matched_pattern === RECLINER_API_PATH.DB_BASE){
                                return {action:Action.POST_A_NEW_DOC, direction: r}
                            }
                            break;
                        }
                        case HttpMethod.PUT:{
                            if(r.matched_pattern === RECLINER_API_PATH.DB_BASE){
                                return {action:Action.PUT_A_NEW_DB, direction: r}
                            }
                        }
                        case HttpMethod.DELETE:{
                            if(r.matched_pattern === RECLINER_API_PATH.RECLINER_DELETE){
                                return {action: Action.RECLINER_DELETE};
                            }else if(r.matched_pattern === RECLINER_API_PATH.DB_BASE){
                                return {action:Action.DELETE_THE_DB, direction: r}
                            }
                        }
                    }
                }
                case 4:{
                    if(r.path_params["docid"] && !r.path_params["docid"].startsWith("_")){
                        switch(method){
                            case HttpMethod.HEAD:
                                return {action: Action.CHECK_DOC_EXISTENCE, direction: r}
                            case HttpMethod.GET:
                                return {action: Action.GET_THE_DOCUMENT, direction: r}
                            case HttpMethod.PUT:
                                return {action: Action.PUT_A_DOC, direction: r};
                            case HttpMethod.DELETE:
                                return {action: Action.DELETE_THE_DOC, direction: r}
                            default:
                                return {action:Action.CASE_DO_NOT_EXIST, direction: r};  
                        }
                    }
                    switch(r.matched_pattern){
                        case RECLINER_API_PATH.DB_CHANGES:{
                            switch(method){
                                case HttpMethod.GET:{
                                    return {action:Action.GET_CHANGE_FEED, direction: r}; 
                                }
                                case HttpMethod.POST:{
                                    return {action:Action.POST_CHANGE_FEED, direction: r}; 
                                }
                                default:{
                                    return {action:Action.CASE_DO_NOT_EXIST, direction: r};  
                                }
                            }
                        }
                        case RECLINER_API_PATH.DB_BULK_GET:{
                            switch(method){
                                case HttpMethod.POST:{
                                    return {action: Action.BULK_GET, direction: r};
                                }
                                default:{
                                    return {action:Action.CASE_DO_NOT_EXIST, direction: r};  
                                }
                            }
                        }
                        case RECLINER_API_PATH.DB_REV_DIFF:{
                            switch(method){
                                case HttpMethod.POST:{
                                    return {action: Action.POST_REVS_DIFF, direction: r}
                                }
                                default:
                                    return {action:Action.CASE_DO_NOT_EXIST, direction: r};  
                            }
                        }
                        case RECLINER_API_PATH.DB_INDEX:{
                            switch(method){
                                case HttpMethod.POST:
                                    return {action: Action.CREATE_INDEX, direction: r}
                                default:
                                    return {action:Action.CASE_DO_NOT_EXIST, direction: r};  
                            }
                        }
                        case RECLINER_API_PATH.DB_FIND:{
                            switch(method){
                                case HttpMethod.POST:
                                    return {action: Action.FIND_IN_INDEX, direction: r}
                                default:
                                    return {action:Action.CASE_DO_NOT_EXIST, direction: r};  
                            }
                        }
                        case RECLINER_API_PATH.DB_DB_DESIGN:{
                            switch(method){
                                case HttpMethod.HEAD:
                                    return {action:Action.CHECK_DB_DESIGN,direction:r}
                                case HttpMethod.PUT:
                                    return {action:Action.PUT_DB_DESIGN,direction:r}
                                case HttpMethod.POST:
                                    return {action:Action.QUERY_DB_DESIGN,direction:r}
                                default:
                                    return {action:Action.CASE_DO_NOT_EXIST, direction: r};
                            }
                        }
                        case RECLINER_API_PATH.DB_RUN_UPDATE_FUNCTIONS:{
                            switch(method){
                                case HttpMethod.PUT:{
                                    return {action:Action.RUN_UPDATE_FUNCTIONS,direction:r};
                                }
                                default:
                                    return {action:Action.CASE_DO_NOT_EXIST, direction: r};
                            }
                        }
                    }
                }
                case 5:{
                    switch(r.matched_pattern){
                        case RECLINER_API_PATH.DB_DESIGN:{
                            switch(method){
                                case HttpMethod.HEAD:
                                    return {action: Action.CHECK_DESIGN_DOC_EXISTENCE, direction: r};
                                case HttpMethod.GET:
                                    return {action: Action.GET_THE_DESIGN_DOC, direction: r}
                                case HttpMethod.PUT:
                                    return {action: Action.PUT_A_DESIGN_DOC, direction: r}
                                case HttpMethod.DELETE:
                                    return {action: Action.DELETE_A_DESIGN_DOC, direction: r}
                                default:
                                    return {action:Action.CASE_DO_NOT_EXIST, direction: r}; 
                            }
                        }
                        case RECLINER_API_PATH.DB_LOCAL_DOC:{
                            switch(method){
                                case HttpMethod.HEAD:
                                    return {action:Action.CHECK_LOCAL_DOC,direction: r}
                                case HttpMethod.GET:
                                    return {action: Action.GET_LOCAL_DOC, direction: r}
                                case HttpMethod.PUT:
                                    return {action: Action.PUT_A_LOCAL_DOC, direction: r}
                                case HttpMethod.DELETE:
                                    return {action: Action.DELETE_A_LOCAL_DOC, direction: r}
                                default:
                                    return {action:Action.CASE_DO_NOT_EXIST, direction: r};    
                            }
                        }
                        case RECLINER_API_PATH.DB_ATTACHMENT:{
                            switch(method){
                                case HttpMethod.HEAD:
                                    return {action:Action.CHECK_ATTACHMENT_EXISTENCE, direction: r};    
                                case HttpMethod.GET:
                                    return {action:Action.GET_ATTACHMENT_FOR_THE_DOC, direction: r};    
                                case HttpMethod.PUT:
                                    return {action:Action.PUT_AN_ATTACHMENT_TO_THE_DOC, direction: r};   
                                case HttpMethod.DELETE:
                                    return {action:Action.DELETE_THE_ATTACHMENT_OF_THE_DOC, direction: r};    
                                default:
                                    return {action:Action.CASE_DO_NOT_EXIST, direction: r};    
                            }
                        }   
                    }
                }
                case 7:{
                    switch(r.matched_pattern){
                        case RECLINER_API_PATH.DB_VIEW:{
                            switch(method){
                                case HttpMethod.GET:
                                    return {action:Action.GET_THE_RESULT_OF_VIEW, direction: r};    
                                case HttpMethod.POST:
                                    return {action:Action.POST_A_VIEW_QUERY, direction: r};    
                                default:
                                    return {action:Action.CASE_DO_NOT_EXIST, direction: r};
                            }
                        }
                        case RECLINER_API_PATH.DB_DELETE_INDEX:{
                            switch(method){
                                case HttpMethod.DELETE:
                                    return {action:Action.DELETE_INDEX, direction: r};
                                default:
                                    return {action:Action.CASE_DO_NOT_EXIST, direction: r};
                            }
                        }   
                        
                    }
                }
            }
            return {action:Action.CASE_DO_NOT_EXIST, direction: r};
        }else{
            return {action:Action.CASE_DO_NOT_EXIST};
        }
    }
}

export interface URIEngineResult{
    direction?: PathDirection;
    action: Action;
}