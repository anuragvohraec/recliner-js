
import { Bookmark, DifferentOperatorInfo, DifferentRulesOperators, ExecutionStats, MostEfficientIndex } from "../../interfaces";
import { R, Sort } from "../../recliner";
import { CondOps, Utils, FlattenObject, FlattenSelector } from "../../utils";
import {Selector} from '../../interfaces';
import { ComparatorCake, JSObjectComparators } from "../comparator";

export interface Views {
    [viewname: string]: {
        map: string | { fields: Sort }
        options?: { def: { fields: string[] } }
    }
}

export interface Design {
    _id: string;
    _rev?: string;
    language: "javascript"|"query";
    validate_doc_update?: string;
    views?: Views
}

export interface DBDetails {
    name: string;
    primaryKeyName?: string;
    keyGenerator?: boolean;
}



export interface FindResult {
    docs: any[];
    bookmark?: string;
    execution_stats: ExecutionStats
}

/**
 * UpdateObjectFunction are used to update the object in DB.
 * the update function of a DAO, is given primarykey for object and this update function.
 * update function first searches for the object if found it passes it to the update function and expect to receive the modified doc, which it then saves to db.
 * If no object is returned it skips the update [so business logic can can be implemented inside to abort or perform an update]
 * if no object is found , than it will simply ignore this function.
 */
export interface UpdateObjectFunction {
    (oldObject: any): any;
}

type OperatorIndexRangeMap = { [op: string]: { [index: string]: IDBKeyRange } };

/**
 * This is a generic Indexed DB interface. No recliner/couchdb logic must come inside this.
 * It mut sbe agnostic of who uses it.
 */
export abstract class DAO {
    req: IDBOpenDBRequest;
    db: IDBDatabase;
    isInitialized: Promise<boolean>;
    protected _change_seq:number=0;

    constructor(protected databaseName: string, protected _version: number, protected listofDBDetails: DBDetails[], protected designs?: Design[]) {
        if (indexedDB) {
            this.req = indexedDB.open(databaseName, _version);

            this.req.onupgradeneeded = this.onupgradeneeded;

            this.isInitialized = new Promise<boolean>((res, rej) => {
                this.req.onsuccess = (e) => {
                    this.db = this.req.result;
                    if(databaseName!==R._system){
                        this.getCountInStore(R._changes).then(v=>{this._change_seq=v;res(true);});
                    }else{
                        res(true);
                    }
                    
                };
            });

            // this.isInitialized.then(i=>{
            //     if(databaseName!==R._system){
            //         this.getCountInStore(R._changes).then(v=>{
            //             this._change_seq=v;
            //         });
            //     }
            // })
        }
    }


    public get version(): number {
        return this._version;
    }


    protected onupgradeneeded = (e: any) => {
        // Get a reference to the request related to this event
        // @type IDBOpenRequest (a specialized type of IDBRequest)
        const request: IDBOpenDBRequest = e.target;

        // Get a reference to the IDBDatabase object for this request
        // @type IDBDatabase
        this.db = request.result;

        // Get a reference to the implicit transaction for this request
        // @type IDBTransaction
        const txn = request.transaction;

        this.listofDBDetails.forEach(element => {
            this.createObjectStoreInDB(txn, element.name, element.primaryKeyName, element.keyGenerator);
        });
        
    }

    
    public get change_seq() : number {
        this._change_seq++;
        return this._change_seq;
    }
    

    private _initializeAllDesignsAndValidations(_idOS: IDBObjectStore) {
        //TODO validations
        if (this.designs && this.designs.length > 0) {
            for (let i = 0; i < this.designs.length; i++) {
                const views = this.designs[i].views;
                if (views) {
                    const viewsKeys = Object.keys(views);
                    for (let j = 0; j < viewsKeys.length; j++) {
                        const viewName = viewsKeys[j];
                        const aView = views[viewName];

                        //dealing with pure indexes : Not views
                        if (aView.options) {
                            //this means it plain simple index based doc
                            const fields = aView.options.def.fields;
                            for (let f of fields) {
                                //if no such index is present then create index on it.
                                if (!_idOS.indexNames.contains(f)) {
                                    if(f.endsWith("_m")){
                                        _idOS.createIndex(f, f, { unique: false, multiEntry: true});
                                    }else{
                                        _idOS.createIndex(f, f, { unique: false });
                                    }
                                }
                                //TODO dropping of old indexes, as if design is modified and some index is no more required
                                //why hold it any more.
                            }
                        }

                        //TODO: checking for views
                    }
                }
            }
        }
    }

    public closeTheDB() {
        this.db.close();
    }

    public static async checkIfDBExist(dbname: string) {
        //@ts-ignore
        return (await indexedDB.databases()).map(e => e.name).includes(dbname) as boolean;
    }

    /**
     * returns -1 when store do no exist
     * @param storeName 
     */
    public async getCountInStore(storeName: string) {
        try {
            const tx = this.db.transaction([storeName]);
            const os = tx.objectStore(storeName);
            const resp = os.count();
            return await new Promise<number>((res)=>{
                resp.onsuccess=()=>{
                    res(resp.result);
                }
            });
        } catch (e) {
            console.error(e);
            return -1;
        }
    }

    public async getLastObjectFromObjectStore(storeName: string) {
        try {
            const tx = this.db.transaction([storeName]);
            const os = tx.objectStore(storeName);

            const cr = os.openCursor(null, "prev");
            const cursor = await new Promise<IDBCursorWithValue>((res, rej) => {
                cr.onsuccess = (ev) => {
                    //@ts-ignore
                    res(ev.target.result);
                };
                cr.onerror = rej;
            });
            return cursor?.value;
        } catch (e) {
            console.error(e);
            return;
        }
    }

    public async deleteTheDB() {
        if (this.isInitialized) {
            try {
                this.closeTheDB();
                const req = indexedDB.deleteDatabase(this.databaseName);
                const event = await (async () => {
                    return new Promise<{ type: string }>((res, rej) => {
                        req.onsuccess = res;
                        req.onerror = rej;
                    });
                })();
                return event.type === 'success';
            } catch (e) {
                console.error("Failed to delete the database");
                console.error(e);
                return false;
            }
        }
    }

    async cleanAllObjectStores(){
        let allGood=false;
        if (await this.isInitialized) {
            const l = this.db.objectStoreNames.length;
            try{
                for(let i=0;i<l;i++){
                    const osName = this.db.objectStoreNames.item(i);
        
                    const os = this.db.transaction([osName], 'readwrite').objectStore(osName);
                    const req = os.clear();
                    
                    if(!await new Promise<boolean>(res=>{
                            req.onsuccess=(e:Event)=>{
                                res(true);
                            }
                            req.onerror=(e:Event)=>{
                                res(false);
                            }
                        })
                    ){
                        throw `${osName} not cleared`;
                    }
                }
                allGood=true;
            }catch(e){
                console.error(e);
            }
        }
        return allGood;
    }

    private createObjectStoreInDB(txn: IDBTransaction, dbname: string, primaryKeyName?: string, keyGenerator?: boolean) {
        if (!this.db.objectStoreNames.contains(dbname)) {
            const objStore = this.db.createObjectStore(dbname, { keyPath: primaryKeyName, autoIncrement: keyGenerator })
            if(dbname === R._changes){
                //dp create seq and id index too
                objStore.createIndex(R.seq, R.seq);
                objStore.createIndex(R.id,R.id);
                objStore.createIndex(R._id,R._id);
            }
        } else {
            if (dbname === R._id) {
                const store = txn.objectStore(dbname);
                this._initializeAllDesignsAndValidations(store);
            }
        }
    }

    async create(dbname: string, objectToSave: any) {
        if (await this.isInitialized) {
            try {
                const req = this.db.transaction([dbname], 'readwrite')
                    .objectStore(dbname)
                    .add(objectToSave);

                return await new Promise<boolean>((res, rej) => {
                    req.onsuccess =()=>{
                        res(true);
                    };
                    req.onerror = (e)=>{
                        console.error(e);
                        res(false);
                    }
                });
            } catch (e) {
                console.error("Failed to create");
                console.error(e);
                return false
            }
        }
    }

    /**
     * creates if no present, else updates the existing doc
     * @param dbname 
     * @param key 
     * @param doc 
     */
    async updateItemWithKey(dbname: string, key: string, doc: any) {
        //check if it exist
        const objectStore = this.db.transaction([dbname], 'readwrite').objectStore(dbname);

        if (objectStore) {
            const doKeyExist = await (new Promise<boolean>((res, rej) => {
                objectStore.getKey(key).onsuccess = (e) => {
                    //@ts-ignore
                    let key = e.target.result;
                    key ? res(true) : res(false);
                }
            }));
            //if do key exist
            if (doKeyExist) {
                //we will need to update the existing doc
                return await (new Promise<boolean>((res, rej) => {
                    const req = objectStore.put(doc, key);

                    req.onsuccess = (e) => {
                        res(true);
                    }

                    req.onerror = (e) => {
                        console.error(`Failed to save attachment ${this.databaseName}/${key}`);
                        console.error(e);
                        res(false);
                    }
                }));
            } else {
                return await (new Promise<boolean>((res, rej) => {
                    const req = objectStore.add(doc, key);
                    req.onsuccess = (e) => {
                        res(true);
                    }

                    req.onerror = (e) => {
                        console.error(`Failed to save attachment ${this.databaseName}/${key}`);
                        console.error(e);
                        res(false);
                    }
                }));
            }
        } else {
            console.log("No such DB: ", dbname);
            return false;
        }
    }

    async read(dbname: string, indexValue?: any) {
        if (await this.isInitialized) {
            return await this._read(dbname, indexValue);
        }
    }

    async checkKey(dbname:string , indexvalue:any):Promise<boolean>{
        const transaction = this.db.transaction([dbname]);
        const objectStore = transaction.objectStore(dbname);
        const req=objectStore.count(indexvalue);
        return await new Promise<boolean>((res,rej)=>{
            req.onsuccess=(e:Event)=>{
                if(req.result===0){
                    res(false);
                }else{
                    res(true);
                }
            }
            req.onerror=(e)=>{
                rej(e);
            }
        });
    }

    /**
     * Do not check is initialized, used during onupgrade needed by the derivative classes.
     * @param dbname 
     * @param indexValue 
     */
    async _read(dbname: string, indexValue?: any) {
        try {
            const transaction = this.db.transaction([dbname]);
            const objectStore = transaction.objectStore(dbname);
            if (indexValue) {
                const req = objectStore.get(indexValue);
                return await new Promise<any>((res)=>{
                    req.onsuccess=(e:Event)=>{
                        //@ts-ignore
                        res(e.target.result);
                    }
                    req.onerror=(e)=>{
                        res(undefined);
                    }
                });
                // const event = await (async () => {
                //     return new Promise<any>((res, rej) => {
                //         req.onsuccess = res;
                //         req.onerror = rej;
                //     });
                // })();
                // return event.target.result;
            } else {
                return await new Promise<any>((res)=>{
                    let t =objectStore.getAll();
                    t.onsuccess=(e:Event)=>{
                        //@ts-ignore
                        res(e.target.result);
                    };
                    t.onerror=(e:Event)=>{
                        res(undefined);
                    }
                });
                // const event = await (async () => {
                //     return new Promise<any>((res, rej) => {
                //         objectStore.getAll().onsuccess = res;
                //     })
                // })();
                // return event.target.result;
            }
        } catch (e) {
            console.error(e);
        }
    }

    async _update(dbname: string, newUpdatedObject: any) {
        if (await this.isInitialized) {
            try {
                const req = this.db.transaction([dbname], 'readwrite')
                    .objectStore(dbname)
                    .put(newUpdatedObject);

                return await new Promise<boolean>(res=>{
                    req.onsuccess=(e:Event)=>{
                        res(true);
                    }
                    req.onerror=(e:Event)=>{
                        res(false);
                    }
                })
                // const event = await (async () => {
                //     return new Promise<any>((res, rej) => {
                //         req.onsuccess = res;
                //         req.onerror = rej;
                //     });
                // })();
                // return event.type === 'success';
            } catch (e) {
                console.error("Failed to update");
                console.error(e);
                return false
            }
        }
    }


    async update(dbname: string, primaryKey: string, updateObjectFunction: UpdateObjectFunction, docToCreate?:any) {
        const doc = await this.read(dbname, primaryKey);
        if (!doc) {
            if(docToCreate){
                return await this._update(dbname,docToCreate);
            }
        }
        const newUpdatedObject = await updateObjectFunction(doc);
        if (!newUpdatedObject) {
            return false;
        } else {
            return await this._update(dbname, newUpdatedObject);
        }
    }


    async delete(dbname: string, indexValue: any) {
        if (await this.isInitialized) {
            const req = this.db.transaction([dbname], 'readwrite')
                .objectStore(dbname)
                .delete(indexValue);
            
            return await new Promise<boolean>(res=>{
                req.onsuccess=(e:Event)=>{
                    res(true);
                }
                req.onerror=(e:Event)=>{
                    res(false);
                }
            })
            // const event = await (async () => {
            //     return new Promise<any>((res, rej) => {
            //         req.onsuccess = res;
            //         req.onerror = rej;
            //     });
            // })();
            // return event.type === 'success';
        }
    }



    private _convertStringToBookmark(bookmark?: string): Bookmark | undefined {
        return bookmark ? JSON.parse(atob(bookmark)) : undefined;
    }

    private _convertBookmarkToString(bookmark: Bookmark): string {
        return btoa(JSON.stringify(bookmark));
    }

    /**
     * Converts and object like these `{$gt: 5}`, `{$within: [12, 34]}` to appropriate IDBKeyRange object
     * @param opObj 
     */
    private _convertOpsToIDBKeyRange(opObj: FlattenObject): IDBKeyRange | undefined {
        const keys = Object.keys(opObj);
        const op = keys[0];
        const v = opObj[op];
        let idbRangeObject: IDBKeyRange | undefined;
        switch (op) {
            case "$lt": idbRangeObject = IDBKeyRange.upperBound(v, true); break;
            case "$lte": idbRangeObject = IDBKeyRange.upperBound(v); break;
            case "$eq": idbRangeObject = IDBKeyRange.only(v); break;
            case "$gte": idbRangeObject = IDBKeyRange.lowerBound(v); break;
            case "$gt": idbRangeObject = IDBKeyRange.lowerBound(v, true); break;
            case "$within": {
                if (!Array.isArray(v)) {
                    throw `For using $within operator you must provide an array of size two`
                }
                idbRangeObject = IDBKeyRange.bound(v[0], v[1]);
                break;
            }
            default: break;
        }
        return idbRangeObject;
    }

    private _checkIfFlattedSelectorUsesDifferentRules(flattedSelector: FlattenSelector): DifferentOperatorInfo | undefined {
        const keys = Object.keys(flattedSelector);
        for (let k of keys) {
            const opWithValue = flattedSelector[k];
            const k2 = Object.keys(opWithValue);
            const op = k2[0];
            if (DifferentRulesOperators.has(op)) {
                return {
                    index: k,
                    op: op,
                    value: opWithValue[op]
                };
            }else{
                break;
            }
        }
        return;
    }

    async _findResultForSelectorsWithDifferentRules(opsInfo: DifferentOperatorInfo,
        flattedSelector: FlattenSelector, objectStore: IDBObjectStore, limit: number = -1, skip: number = 0): Promise<FindResult> {
        const start: number = new Date().getTime();

        const execution_stats: ExecutionStats = {
            execution_time_ms: 0,
            results_returned: 0,
            total_docs_examined: 0,
            total_keys_examined: 0
        }
        const docs: any[] = [];
        let offset = 0;
        let count = 0;


        switch (opsInfo.op) {
            case "$in": {
                if (!Array.isArray(opsInfo.value)) {
                    throw `For $in operator value must be an array.`;
                }

                if (objectStore.indexNames.contains(opsInfo.index)) {
                    //we will work on index  
                    const index = objectStore.index(opsInfo.index);
                    let isDone = true;
                    for (let v of opsInfo.value) {
                        const index_range = IDBKeyRange.only(v);
                        let t: boolean = await (new Promise<boolean>((res, rej) => {
                            index.openCursor(index_range).onsuccess = (event: Event) => {
                                //@ts-ignore
                                const cursor: IDBCursorWithValue = event.target.result;
                                execution_stats.total_keys_examined++;

                                if (cursor) {
                                    //TODO run comparison, between flatten object and selectors
                                    const flatObj = Utils.flattenObjects(cursor.value);
                                    if (this._matchFlattenObject(flatObj, flattedSelector)) {
                                        if (skip > offset) {
                                            offset++;
                                            cursor.continue();
                                        } else {
                                            if (limit === count) {
                                                res(true);
                                            } else {
                                                docs.push(cursor.value);
                                                count++;
                                                cursor.continue();
                                            }
                                        }
                                    } else {
                                        cursor.continue();
                                    }
                                } else {
                                    //entries
                                    res(true);
                                }
                            }
                        }));
                        isDone = isDone && t;
                        if (!isDone) {
                            break;
                        }
                    }
                    if (!isDone) {
                        console.error("Not all index ranges are executed!, result will be wrong!");
                    }
                } else {
                    //full cursor will be worked out
                    let isDone = true;
                    for (let v of opsInfo.value) {
                        const index_range = IDBKeyRange.only(v);
                        let t: boolean = await (new Promise<boolean>((res, rej) => {
                            objectStore.openCursor(index_range).onsuccess = (event: Event) => {
                                //@ts-ignore
                                const cursor: IDBCursorWithValue = event.target.result;

                                execution_stats.total_keys_examined++;

                                if (cursor) {
                                    //TODO run comparison, between flatten object and selectors
                                    const flatObj = Utils.flattenObjects(cursor.value);
                                    if (this._matchFlattenObject(flatObj, flattedSelector)) {
                                        if (skip > offset) {
                                            offset++;
                                            cursor.continue();
                                        } else {
                                            if (limit === count) {
                                                res(true);
                                            } else {
                                                docs.push(cursor.value);
                                                count++;
                                                cursor.continue();
                                            }
                                        }
                                    } else {
                                        cursor.continue();
                                    }
                                } else {
                                    //entries
                                    res(true);
                                }
                            }
                        }));
                        isDone = isDone && t;
                        if (!isDone) {
                            break;
                        }
                    }
                    if (!isDone) {
                        console.error("Not all index ranges are executed!, result will be wrong!");
                    }
                }
                break;
            }
            default:
                throw `Operator ${opsInfo.op} not supported!`;
        }

        const end = new Date().getTime();
        execution_stats.execution_time_ms = end - start;
        execution_stats.results_returned = docs.length;

        return { docs, execution_stats}
    }


    async find(query:{dbname: string, selector: Selector, sort?: Sort, limit?: number,skip?: number, bookmark?: string, fields?:string[]}): Promise<FindResult> {
        let limit = query.limit?query.limit:-1;
        let skip = query.skip?query.skip:0;

        try {

            let docs: any[] = [];
            const start: number = new Date().getTime();

            const execution_stats: ExecutionStats = {
                execution_time_ms: 0,
                results_returned: 0,
                total_docs_examined: 0,
                total_keys_examined: 0
            }
            const objectStore = this.db.transaction(query.dbname).objectStore(query.dbname);

            let offset = 0;
            let count = 0;

            let curr_bookmark = this._convertStringToBookmark(query.bookmark);

            //1. Flatten selector
            const flattedSelector = Utils.selectorFlatter(query.selector);

            const diffOp = this._checkIfFlattedSelectorUsesDifferentRules(flattedSelector);
            if (diffOp) {
                return await this._findResultForSelectorsWithDifferentRules(diffOp, flattedSelector, objectStore,  limit, skip);
            }

            let mostEfficientIndexStats: MostEfficientIndex;
            if (query.bookmark) {
                mostEfficientIndexStats = {
                    no_match: curr_bookmark.primaryKey ? false : true,
                }
                if (curr_bookmark.mostEfficientIndex) {
                    let keys = Object.keys(curr_bookmark.mostEfficientIndex);
                    mostEfficientIndexStats.mostEfficientIndex = keys[0];
                    mostEfficientIndexStats.index_range = this._convertOpsToIDBKeyRange(curr_bookmark.mostEfficientIndex[keys[0]])
                }
                if(curr_bookmark.key){
                    mostEfficientIndexStats.key = curr_bookmark.key;
                }
            } else {
                let mostEfficientIndex:FlattenSelector;
                let no_match:boolean = true;
                let index_range: IDBKeyRange;

                //3. Check all indexes in objectStore, which are present in flatten result, add them to applicable_indices
                for (let k of Object.keys(flattedSelector)) {
                    if (objectStore.indexNames.contains(k)) {
                        mostEfficientIndex={};
                        mostEfficientIndex[k]=flattedSelector[k];
                        break;
                    }
                }

                if(mostEfficientIndex){
                    no_match=false;
                    let k = Object.keys(mostEfficientIndex);
                    const operatorObj = mostEfficientIndex[k[0]];
                    const keys = Object.keys(operatorObj);
                    if (keys.length !== 1) {
                        throw `There is a bug in : Utils.selectorFlatter function of Recliner DB!, as this should never happen.`;
                    }
                    index_range = this._convertOpsToIDBKeyRange(operatorObj);
                    
                    mostEfficientIndexStats = {mostEfficientIndex:k[0],no_match,index_range};

                    curr_bookmark = {
                        key: undefined,
                        primaryKey: undefined,
                        mostEfficientIndex
                    }

                    execution_stats.primary_index=k[0];
                }
            }

            let firstSortIndex;
            if(query.sort){
                firstSortIndex = Object.keys(query.sort)[0];
            }
            const sortOrder = query.sort?.[firstSortIndex]==="desc"?"prev":"next";

            if (!mostEfficientIndexStats?.no_match) {
                let bookmark_used_once = false;
                let skip_once = false;
                if (mostEfficientIndexStats?.mostEfficientIndex && mostEfficientIndexStats.index_range) {
                    //perform search on this index
                    const index = objectStore.index(mostEfficientIndexStats.mostEfficientIndex);
                    const isDone = await (new Promise<boolean>((res, rej) => {
                        index.openCursor(mostEfficientIndexStats.index_range,sortOrder).onsuccess = (event: Event) => {
                            //@ts-ignore
                            const cursor: IDBCursorWithValue = event.target.result;

                            if (!bookmark_used_once && mostEfficientIndexStats.key) {
                                bookmark_used_once = true;
                                if (cursor) {
                                    if(cursor.primaryKey === curr_bookmark.primaryKey){
                                        cursor.continue();
                                    }else{
                                        cursor.continuePrimaryKey(mostEfficientIndexStats.key, curr_bookmark.primaryKey);
                                    }
                                }
                                return;
                            }
                            if (bookmark_used_once && !skip_once) {
                                skip_once = true;
                                if (cursor) {
                                    cursor.continue();
                                }
                                return;
                            }
                            execution_stats.total_keys_examined++;

                            if (cursor) {
                                //TODO run comparison, between flatten object and selectors
                                const flatObj = Utils.flattenObjects(cursor.value);
                                if (this._matchFlattenObject(flatObj, flattedSelector)) {
                                    if (skip > offset) {
                                        offset++;
                                        cursor.continue();
                                    } else {
                                        if (limit === count) {
                                            res(true);
                                        } else {
                                            curr_bookmark.key = cursor.key;
                                            curr_bookmark.primaryKey = cursor.primaryKey;
                                            docs.push(cursor.value);
                                            count++;
                                            cursor.continue();
                                        }
                                    }
                                } else {
                                    cursor.continue();
                                }
                            } else {
                                //entries
                                res(true);
                            }
                        }
                    }));
                } else {
                    //then we need to do full cursor search
                    if(!curr_bookmark){
                        //@ts-ignore
                        curr_bookmark={};
                    }

                    const isDone = await (new Promise<boolean>((res, rej) => {

                        objectStore.openCursor(null,sortOrder).onsuccess = (event) => {
                            //@ts-ignore
                            const cursor: IDBCursorWithValue = event.target.result;

                            if (!bookmark_used_once && mostEfficientIndexStats?.key) {
                                bookmark_used_once = true;
                                if (cursor) {
                                    if(cursor.primaryKey === curr_bookmark.primaryKey){
                                        cursor.continue();
                                    }else{
                                        cursor.continue(curr_bookmark.primaryKey);
                                    }
                                }
                                return;
                            }
                            if (bookmark_used_once && !skip_once) {
                                skip_once = true;
                                if (cursor) {
                                    cursor.continue();
                                }
                                return;
                            }
                            execution_stats.total_docs_examined++;

                            if (cursor) {
                                //TODO run comparison, between flatten object and selectors
                                const flatObj = Utils.flattenObjects(cursor.value);
                                if (this._matchFlattenObject(flatObj, flattedSelector)) {
                                    if (skip > offset) {
                                        offset++;
                                        cursor.continue();
                                    } else {
                                        if (limit === count) {
                                            res(true);
                                            return;
                                        } else {
                                            curr_bookmark.key = cursor.key;
                                            curr_bookmark.primaryKey = cursor.primaryKey;
                                            docs.push(cursor.value);
                                            count++;
                                            cursor.continue();
                                        }
                                    }
                                } else {
                                    cursor.continue();
                                }
                            } else {
                                //entries
                                res(true);
                                return;
                            }
                        }
                    }));
                }
            }
            
            if(query.sort){
                const comparatorCake: ComparatorCake = JSObjectComparators.bakeAComparatorForIndexedFields(query.sort);
                docs.sort(comparatorCake.compare);
            }
            
            // if(query.fields && query.fields.length>0){
            //     let t: any[] = docs.map(e=>{
            //         let d:any={};
            //         d[R._id]=e[R._id];
            //         for(let f of query.fields){
            //             if(e[f]){
            //                 d[f]=e[f];
            //             }
            //         }
            //         return d;
            //     });
            //     docs=t;
            // }


            if(query.fields && query.fields.length>0){
                let t: any[] = docs.map(doc=>{
                                    let newDoc:any={};
                                    let old_depth_doc=doc;
                                    let current_depth_doc:any = newDoc;
                                    newDoc[R._id]=doc[R._id];
                                    for(let f of query.fields){
                                        let fl = f.split(".");
                                        for(let i=0;i<fl.length;i++){
                                            if(old_depth_doc[fl[i]]){
                                                if(i===(fl.length-1)){
                                                    current_depth_doc[fl[i]]=old_depth_doc[fl[i]];
                                                }else{
                                                    if(!current_depth_doc[fl[i]]){
                                                        current_depth_doc[fl[i]]={};
                                                    }
                                                    current_depth_doc=current_depth_doc[fl[i]];
                                                    old_depth_doc=old_depth_doc[fl[i]];
                                                }
                                            }
                                        }
                                    }
                                    return newDoc;
                                });
                docs=t;
            }

            const end = new Date().getTime();
            execution_stats.execution_time_ms = end - start;
            execution_stats.results_returned = docs.length;
            const final_bookmark = this._convertBookmarkToString(curr_bookmark);

            

            return { docs, execution_stats, bookmark: final_bookmark }
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * returns true if object satisfy the selector
     * @param flatObj 
     * @param flattedSelector 
     */
    private _matchFlattenObject(flatObj: FlattenObject, flattedSelector: FlattenSelector): boolean {
        let matched = true;
        for (let i in flattedSelector) {
            if (matched) {
                if(i.endsWith("_m")){
                    matched = matched && this._matchAnEntryOfFlattenObject(flattedSelector[i], flatObj[i],true);
                }else{
                    matched = matched && this._matchAnEntryOfFlattenObject(flattedSelector[i], flatObj[i],false);
                }
            } else {
                break;
            }
        }
        return matched;
    }

    /**
     * 
     * @param ops is like : {$eq : "123"}
     * @param val value in actual object
     * @param is_multiEntryMatch 
     * @returns 
     */
    private _matchAnEntryOfFlattenObject(ops: FlattenObject, val: any, is_multiEntryMatch:boolean): boolean {
        const op = Object.keys(ops)[0];
        const op_val = ops[op];

        if(val === undefined && op !== "$exists"){
            return false;
        }

        switch ((op as CondOps)) {
            case "$lt": {
                const r = indexedDB.cmp(op_val, val);
                switch (r) {
                    case -1: return false;
                    case 0: return false;
                    case 1: return true;
                }
            }
            case "$lte": {
                const r = indexedDB.cmp(op_val, val);
                switch (r) {
                    case -1: return false;
                    case 0: return true;
                    case 1: return true;
                }
            };
            case "$eq": {
                if(is_multiEntryMatch){
                    return (val as Array<any>).includes(op_val);
                }
                const r = indexedDB.cmp(op_val, val);
                switch (r) {
                    case -1: return false;
                    case 0: return true;
                    case 1: return false;
                }
            };
            case "$ne": {
                const r = indexedDB.cmp(op_val, val);
                switch (r) {
                    case -1: return true;
                    case 0: return false;
                    case 1: return true;
                }
            };
            case "$gte": {
                const r = indexedDB.cmp(op_val, val);
                switch (r) {
                    case -1: return true;
                    case 0: return true;
                    case 1: return false;
                }
            };
            case "$gt": {
                const r = indexedDB.cmp(op_val, val);
                switch (r) {
                    case -1: return true;
                    case 0: return false;
                    case 1: return false;
                }
            };
            case "$within": {
                if(Array.isArray(op_val)){
                    //lets check if its bounding box search
                    let isBBox = Array.isArray(op_val[0]) && Array.isArray(op_val[1]);
                    if(isBBox){
                        return val[0]>=op_val[0][0]&&val[1]>=op_val[0][1]&&val[0]<=op_val[1][0]&&val[1]<=op_val[1][1]
                    }else{
                        const lb = (op_val as Array<any>)[0];
                        const ub = (op_val as Array<any>)[1];
                        const lbr = indexedDB.cmp(lb, val);
                        const ubr = indexedDB.cmp(ub, val);

                        if (lbr <= 0 && ubr >= 0) {
                            return true;
                        } else {
                            return false;
                        }
                    }
                }else{
                    return false;
                }

                
            };
            case "$nwithin": {
                if(Array.isArray(op_val)){
                    //lets check if its bounding box search
                    let isBBox = Array.isArray(op_val[0]) && Array.isArray(op_val[1]);
                    if(isBBox){
                        return val[0]<op_val[0][0] || val[1]<op_val[0][1] || val[0]<=op_val[1][0] || val[1]<=op_val[1][1]
                    }else{
                        const lb = (op_val as Array<any>)[0];
                        const ub = (op_val as Array<any>)[1];
                        const lbr = indexedDB.cmp(lb, val);
                        const ubr = indexedDB.cmp(ub, val);

                        if (lbr >= 0 && ubr <= 0) {
                            return false;
                        } else {
                            return true;
                        }
                    }
                }else{
                    return false;
                }
            };
            case "$nin":{
                if(is_multiEntryMatch){
                    for(let t of op_val){
                        let r = (val as Array<any>).includes(t);
                        if(r){
                            return false
                        }
                    }
                    return true;
                }else{
                    return !(op_val as Array<any>).includes(val);
                }
            }
            case "$in":{
                if(is_multiEntryMatch){
                    let r=true;
                    for(let t of op_val){
                        r=r&&(val as Array<any>).includes(t);
                        if(!r){
                            break;
                        }
                    }
                    return r;
                }else{
                    return (op_val as Array<any>).includes(val);
                }
            }
            case "$exists":{
                if(op_val && val){
                    return true;
                }else if(!op_val && !val){
                    return true;
                }else{
                    return false;
                }
            }
            case "$regex":{
                let r = new RegExp(op_val,"i");
                return r.test(val);
            }
            case "$isinpolygon":{
                try{
                    return Utils.checkIfPointInsidePolygon(val,op_val);
                }catch(e){
                    console.error(e);
                    return false;
                }
            }
            case "$isnotinpolygon":{
                try{
                    return !Utils.checkIfPointInsidePolygon(val,op_val);
                }catch(e){
                    console.error(e);
                    return false;
                }
            }
            default: break;
        }
        return false;
    }

    /**
     * 
     * @param objectStore 
     * @param operatorIndexRangeMap 
     * @param threshold_count if an index has less than or equal to this many counts of matching items, then its returned, even if their are indexes faster than this.
     * giving -1 will give the most efficient Index, however finding such an algo takes its own time.
     */
    private async _findMostEfficientIndex(objectStore: IDBObjectStore, operatorIndexRangeMap: OperatorIndexRangeMap, threshold_count: number): Promise<MostEfficientIndex> {
        let mostEfficientIndex: string;
        let min_count: number = 0;
        let index_range: IDBKeyRange;

        /**
         * no match equals true means there is no match
         */
        let no_match: boolean = false;

        let eqDone = false;
        let inDone = false;

        //5. Check length of operatorIndexRangeMap, if it has any key, then we can use range , else we will need to do full cursor search
        if (Object.keys(operatorIndexRangeMap).length > 0) {
            //$eq and $within, is expected to have the least count, so lets use the indexes from them
            //to get the count of items in each of them. And then use them to compare objects
            if (operatorIndexRangeMap["$eq"]) {
                const result = await this._findEfficiencyOfIndex(objectStore, operatorIndexRangeMap, "$eq");
                if (result.no_match) {
                    return { no_match:true }
                }
                mostEfficientIndex = result.mostEfficientIndex;
                min_count = result.min_count;
                index_range = result.index_range;
                eqDone = true;
                if (min_count <= threshold_count) {
                    return { mostEfficientIndex, min_count, no_match, index_range }
                }
            }

            if (operatorIndexRangeMap["$within"]) {
                const result = await this._findEfficiencyOfIndex(objectStore, operatorIndexRangeMap, "$within");
                if (result.no_match) {
                    return { no_match:true }
                }
                if (!eqDone) {
                    mostEfficientIndex = result.mostEfficientIndex;
                    min_count = result.min_count;
                    index_range = result.index_range;
                } else {
                    if (result.min_count < min_count) {
                        mostEfficientIndex = result.mostEfficientIndex;
                        min_count = result.min_count;
                        index_range = result.index_range;
                    }
                }
                inDone = true;
                if (min_count <= threshold_count) {
                    return { mostEfficientIndex, min_count, no_match, index_range }
                }
            }

            const rest_ops = new Set(Object.keys(operatorIndexRangeMap));
            if (eqDone) {
                rest_ops.delete("$eq");
            }
            if (inDone) {
                rest_ops.delete("$within");
            }

            let isSetAtleastOnce: boolean = eqDone || inDone;

            for (let op of rest_ops) {
                const result = await this._findEfficiencyOfIndex(objectStore, operatorIndexRangeMap, op);
                if (result.no_match) {
                    return { no_match:true }
                }
                if (!isSetAtleastOnce) {
                    min_count = result.min_count;
                    mostEfficientIndex = result.mostEfficientIndex;
                    isSetAtleastOnce = true;
                    index_range = result.index_range;
                } else {
                    if (result.min_count < min_count) {
                        mostEfficientIndex = result.mostEfficientIndex;
                        min_count = result.min_count;
                        index_range = result.index_range;
                    }
                }

                if (min_count <= threshold_count) {
                    return { mostEfficientIndex, min_count, no_match, index_range }
                }
            }

            return { mostEfficientIndex, min_count, no_match, index_range };
        }
    }

    private async _findEfficiencyOfIndex(objectStore: IDBObjectStore, operatorIndexRangeMap: OperatorIndexRangeMap, operator: string) {
        let mostEfficientIndex: string;
        let min_count: number = 0;
        let no_match: boolean = false;
        let index_range: IDBKeyRange;

        let iteration = 0;
        for (let i of Object.keys(operatorIndexRangeMap[operator])) {
            const range: IDBKeyRange = operatorIndexRangeMap[operator][i];
            const n = await (new Promise<number>((res, rej) => {
                const idx = objectStore.index(i);
                const reqI = idx.count(range);
                reqI.onsuccess = (e) => {
                    res(reqI.result);
                };
                reqI.onerror = rej;
            }));
            if (iteration === 0) {
                min_count = n;
                mostEfficientIndex = i;
                index_range = range;
            }
            if (n === 0) {
                no_match = true;
                break;
            } else {
                if (n < min_count) {
                    min_count = n;
                    mostEfficientIndex = i;
                    index_range = range;
                }
            }
            iteration++;
        }
        return { mostEfficientIndex, min_count, no_match, index_range }
    }
}

