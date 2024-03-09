# recliner-js
A CouchDB like DB, which runs in your browser.\
Access your saved attachments locally with REST API:
```html
<img src=`/recliner/dbname/doc_id/attachment_name`>
```

# Features
1. Works inside service worker, and hence GUI can use same rest CouchDB API but with in browser recliner DB.
2. Implements CouchDB replicator protocol for seem less replication with backend.
3. Can Lazy load Blobs(video media) from cloud.
4. Partial content and stream supported.
4. Uses IndexedDB as its backend DB and hence no storage restrictions.
5. Mango like queries for searching and replication.
6. Typescript based client to access this API.

# Usage
In your service worker add this:
```js
import {Recliner} from 'recliner-js';
const recliner = new Recliner();//create instance
self.addEventListener("fetch",(e)=>{
    const url_path = Recliner.getPathFromUrl(e.request);
    //mounts recliner
    if(url_path.startsWith("/recliner")){
        e.respondWith(recliner.process(e.request));
    }else{
        // do whatever else
    }
});
```
Now you can access docs and attachments saved in your recliner DB  via URL
```html
<img src=`/recliner/dbname/doc_id/attachment_name`>
```

# CRUD with DB
There are two ways to interact with DB: 
1. Using regular `fetch` in your JS code using REST API similar to CouchDB*.
```js
const getADoc = await fetch(`/recliner/dbname/docid`);
if(getADoc.status === 200){
    return await getADoc.json();//{_id,_rev,ok: true}
}
```
See complete list of [Rest API](#rest-api-supported)

> *Though many , but not all Couch REST API is supported. See [Difference from CouchDB](#difference-from-couchdb) section.

2. Use the a client instead: `UsageDAO`
```js
import {UsageDAO} from 'recliner-js';
//Create
await UsageDAO.postADoc(dbname,{name:"person1",age:30});
//Retrieve
const doc = await UsageDAO.readADoc(dbname,docid);
//Update
await UsageDAO.updateADoc(dbname,doc._id,{name:"person1",age:34});
//Delete 
await UsageDAO.deleteADoc(dbname,doc._id);

//query
const findResult = await UsageDOA.findByPagination({
    dbanme,
    selector:{
        age:{$lt: 40},
        income: {$within:[10000,20000]},
        loc: {$isinpolygon:[]}//has some GIS capability
    }
});

//Save Attachments
await UsageDAO.addAttachmentsToDocID(dbname,doc._id,{
    "my_doc.pdf":DOC_BLOB,
    "my_video.webm":VIDEO_BLOB  
});

//Save attach wth a cloud URl.
//this way when such docs get replicated the Attachments are not sent. As they can be downloaded at end system using the cloud URL
await UsageDAO.addAnAttachmentToExistingDoc(dbname,doc,attachment_name,blob,new_edits,cloud_url,content_type);
//CRUD with attachments on DOC is available

//Replication: say fetch last 10 post
await UsageDAO.replicate({
    selector:{
        post_id
        type:"post",
        time:{$lt: now}
    },
    limit: 10,
    source:{
        url:"/recliner/my_db"
    },
    target:{
        url: "/proxy/couchdb/dbname",
        headers:{
            token:"some_token"
        }
    }
});
```

## Partial content and Media streaming
Save the document with a `cloud_url` in a `_attachments` property.
```js
await fetch("/recliner/dbname/docid",{
    method:"PUT",
    body:{
        _id:docid
        name:"person1",
        _attachments:{
            "my_video.webm":{
                cloud_url:"some_valid_cloud_url_which_supports_partial_content",
            }
        }
    }
});
```

Now this is can be streamed using:
```html
<video src="/recliner/dbname/docid/my_video.webm">
```
The video player will automatically stream the video via recliner.
Using the cloud_url, the docs will be partially downloaded and saved for offline use, and then streamed to `video` element. So next time when user stream the same video, its pulled out from the local cache.

However for all this to work, you need to configure `recliner` for what all mime type you want to support for streaming.
```js
import {Recliner} from 'recliner-js';

const recliner = new Recliner(24,{
    "video/webm":1000_000,//1MB of partial content size for streaming
    "audio/mp3":1000_00//0.1MB of partial content size for streaming
});
```
When configured this way, then whenever an attachments of type `webm` and `mp3` are requested, they are automatically streamed.
If partial content of a doc is not present locally, than using the `cloud_url` its partial content is first pulled from cloud, saved in indexedDB and then streamed to the corresponding requesting GUI components like : `video` and `audio` tags. Next time same partial content will be streamed from local DB, instead of fetching it from cloud_url.


# REST API supported
```js
"/recliner/:db";
"/recliner/:db/_design/:ddoc";
"/recliner/:db/_find";
"/recliner/:db/_index";
"/recliner/_replicate";
"/recliner/:db/_changes";
"/recliner/:db/_bulk_get";
"/recliner/:db/_revs_diff";
"/recliner/:db/_local/:docid";
"/recliner/:db/:docid";
"/recliner/:db/:docid/:attachment";
"/recliner/:db/_db_design";
"/recliner/:db/_run_update_function";
"/recliner/_delete_recliner";
```

# Gotchas
1. For a [multientry](https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/createIndex) search the field name muts end with `_m`
2. Supported query operators: `$lt,$lte,$eq,$ne,$gte,$gt,$exists,$within,$nin,$regex,$in,$isinpolygon,$isnotinpolygon,$nwithin`

# Difference from CouchDB
1. DB level design docs, saved via `UsageDAO.putADBDesign`, can be used to configure various function at DB level :
```ts
export interface DBDesignDoc{
    //name of the DB
    for_db:string;
    //before insertion docs are validated using this 
    doc_validation_function?:string;//this is stringified JS function
    
    //used for map reduce
    map_functions?: Record<string,string>;
    reduce_functions?:Record<string,string>;

    //can be used to mass modify docs using a selector
    update_functions?:Record<string,string>;

    /**
     * Used during remote to local replication using view query as source. [one can pass viewQueryUrl to replication info, to start view based replication]
     * This functions are used to filter view result before replicating them to local DB.
     */
    view_result_filter_functions?:Record<string,string>;
}
```
2.  Views are not supported, however Indexes, Map and Reduce is still supported using `UsageDAO.postQueryToDBDesign<D>(dbname:string, query:MapReduceQuery)`.
3. Design docs are not replicated by default when doing `remote to local` or `local to remote` replication. However for `local to local` replication design docs are copied. By local means database present in the browser. By remote means the one located and accessed via `HTTPS` on DB server(or via a proxy).
4. `_local` **attribute** can be added on doc. They remain solely on local machine, and is removed when are replicated. So some values you wanted to keep in doc, but don;t want to send to server can be saved here. CouchDB Local Docs is supported, which are never replicated.

> Though the most important API, to deal with docs and attachments and Database is implemented. And many which deemed insignificant where dropped.

# Running the Demo
Type this commands in order
1. `npm run i` install dev dependencies
1. `npm run build` builds for typescript system
2. `npm run predemo` adds ".js" extension to build for demo purpose.
3. `npm run demo` : open `http://localhost:8000/demo/index.html` to view the demo

