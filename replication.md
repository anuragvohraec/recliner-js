# Replication
Some steps which are redundant, and can be avoided by a careful design are skipped in. For example create target, this can be ensured before replication. Fro example check source and target this can be checked also before hand. This steps are all good for first time setup, but an experience say,that this steps are one time setup and involves HTTP calls to server. So will not be implementing those in recliner.

# Recliner replication algorithm.

Based on provided `ReplicationInfoJSON` we will check what kind of source and target are given to us.
1. Source = local and Target = local (full replication)
2. Source = local and Target = remote (full replication)
3. Source = remote and Target = local (full replication and lazy replication [attachments are loaded on runtime, when needed from remote source])

## Algorithm
1. Get source Information `GET /source `. This call should give us `update_seq` in the DB info. This will be our milestone. We will fetch change feed till this sequence from  source for the replication.
2. Generate a replication ID. Replication ID is hash of provided `ReplicationInfoJSON`. This replication id is used to create local docs in both source and target and than this local doc is used to track changes which needs to be done and which are still needed to be done. As long as same `ReplicationInfoJSON` is provided, replicator will use same local documents for such tracking and can resume replication from where it left off.
    1. Generate **replication-id**. Hash of `ReplicationInfoJSON`.
    2. Get replication logs from source and target : `GET /source/_local/replication-id` and `GET /target/_local/replication-id`.\
    Sample Rep logs:
    ```json
    {
    "_id": "_local/b3e44b920ee2951cb2e123b63044427a",
    "_rev": "0-8",
    "history": [
        {
            "doc_write_failures": 0,
            "docs_read": 2,
            "docs_written": 2,
            
            "start_last_seq": "7-185d9dfe-701c-4c7d-8566-b8bcff3e70c7",
            "end_last_seq": "9-d4d69ea4-7233-493e-8a7e-3b78d5d2a320",
            
            "start_time": 1608609400476,
            "end_time": 1608609403476,
            
            "recorded_seq": "8-a8329010-a325-4fba-862b-54475cba123",
            "session_id": "d5a34cbbdafa70e0db5cb57d02a6b955"
        }
        ],
        "replication_id_version": 3,
        "last_session_id": "d5a34cbbdafa70e0db5cb57d02a6b955",
        "source_last_seq": "9-d4d69ea4-7233-493e-8a7e-3b78d5d2a320"
        }
    ```
    `session_id` is unique for a replication session. If in case network disconnects, we will create a new session ID on next resume. It signifies a replication session.

    Replication of docs is done in small sets, say 25 changes at a time.\
    Say we have 72 changes in DB which needs replication, then we will loop through them, picking up 25 of them at a time, so we will have three iteration in our loops.0-25,26-50,51-72.
    For `start_last_seq` and `end_last_seq` will be: 0 and 72.
    Upon each iteration it will create a checkpoint, of at what change is done for a given session (at source).
    recorded_seq signifies the intermediate checkpoint position. So the values it will have in above example will be : 25, 50, 72
    

    3. Generate `session_id` (random UUID), for this replication session.
    
    4. If source or target sends 404 for rep logs request, full replication is required.\
    `source_last_seq="0"`, "0" means ful replication

    5. If source and target sends 200 for rep logs, then compare them, to decide from which seq do they need to start the replication from.
        1. Compare `last_session_id` of both source and target. If the match then we source and target do have a common replication history. Then replication needs to be done from `source_last_seq`.\
        `start_seq=source_last_seq`
        2. In case  `last_session_id` do not match, then we need to go through history to find the last common session_id between the source and target. If such a last common session id is found, then use `recorded_seq` as the startup point for replication.\
        `start_seq=recorded_seq`

    6. Startup seq is found in step above, then we will get change feeds. `GET /source/_changes?since=start_seq`.\
    If doc_ids and selector are given use them, else will go fro full replication of all docs.
    ```json
    {"results":[
    {"seq":14,"id":"f957f41e","changes":[{"rev":"3-46a3"}],"deleted":true}
    {"seq":29,"id":"ddf339dd","changes":[{"rev":"10-304b"}]}
    {"seq":37,"id":"d3cc62f5","changes":[{"rev":"2-eec2"}],"deleted":true}
    {"seq":39,"id":"f13bd08b","changes":[{"rev":"1-b35d"}]}
    {"seq":41,"id":"e0a99867","changes":[{"rev":"2-c1c6"}]}
    {"seq":42,"id":"a75bdfc5","changes":[{"rev":"1-967a"}]}
    {"seq":43,"id":"a5f467a0","changes":[{"rev":"1-5575"}]}
    {"seq":45,"id":"470c3004","changes":[{"rev":"11-c292"}]}
    {"seq":46,"id":"b1cb8508","changes":[{"rev":"10-ABC"}]}
    {"seq":47,"id":"49ec0489","changes":[{"rev":"157-b01f"},{"rev":"123-6f7c"}]}
    {"seq":49,"id":"dad10379","changes":[{"rev":"1-9346"},{"rev":"6-5b8a"}]}
    {"seq":50,"id":"73464877","changes":[{"rev":"1-9f08"}]}
    {"seq":51,"id":"7ae19302","changes":[{"rev":"1-57bf"}]}
    {"seq":63,"id":"6a7a6c86","changes":[{"rev":"5-acf6"}],"deleted":true}
    {"seq":64,"id":"dfb9850a","changes":[{"rev":"1-102f"}]}
    {"seq":65,"id":"c532afa7","changes":[{"rev":"1-6491"}]}
    {"seq":66,"id":"af8a9508","changes":[{"rev":"1-3db2"}]}
    {"seq":67,"id":"caa3dded","changes":[{"rev":"1-6491"}]}
    {"seq":68,"id":"79f3b4e9","changes":[{"rev":"1-102f"}]}
    {"seq":69,"id":"1d89d16f","changes":[{"rev":"1-3db2"}]}
    {"seq":71,"id":"abae7348","changes":[{"rev":"2-7051"}]}
    {"seq":77,"id":"6c25534f","changes":[{"rev":"9-CDE"},{"rev":"3-00e7"},{"rev":"1-ABC"}]}
    {"seq":78,"id":"SpaghettiWithMeatballs","changes":[{"rev":"22-5f95"}]}
    ],
    "last_seq":78}
    ```

    7. We will get documents and there latest revision, of sources, from step above. We will then ask target which docs they do have and do they have same revision of docs with them. `POST /target/_revs_diff`, the request and response will be :\
    **Request**
    ```json
    {
        "doc1": [
            "2-7051cbe5c8faecd085a3fa619e6e6337"
        ],
        "doc2": [
            "3-6a540f3d701ac518d3b9733d673c5484"
        ],
        "doc3": [
            "1-d4e501ab47de6b2000fc8a02f84a0c77",
            "1-967a00dff5e02add41819138abb3284d"
        ]
    }
    ```
    **Response**
    ```json
    {
    "doc1": {
        "missing": [
            "2-7051cbe5c8faecd085a3fa619e6e6337"
        ]
    },
    "doc3": {
            "missing": [
                "1-d4e501ab47de6b2000fc8a02f84a0c77"
            ]
        }
    }
    ```
    Response only gives the latest version which are missing at target.

    8. Replicate changes.
        1. If source and target are local, do the replication of all object store from one DB to another.
        2. If source is local and target is remote, then we will place multipart request for docs with attachments. For docs without attachments we will collect them in a stack and use `POST /target/_bulk_docs` for sending documents in bulk and saving HTTP requests.
        3. If source is remote and target is local, then we will use `POST /db/_bulk_get` to get the documents in bulk. We will also look for docs with attachments. And get their attachments in separate requests, however if its a lazy replication we will not download the attachments now. Instead when user do `GET /:db/:docid/:attachment`, then we will make request to the remote system and fetch the attachment.\
        We can also create a method to fetch several attachments in the backend.\
        This will greatly simplify reactive loading of images on screen, with least load on the remote source server.

    9. Update the checkpoints at source and target.
    10. Upon completion of replication, send following stats to client:
    ```
    {
    "history": [
        {
            "doc_write_failures": 2,
            "docs_read": 2,
            "docs_written": 0,
            "end_last_seq": 2939,
            "end_time": "Fri, 09 May 2014 15:14:19 GMT",
            "missing_checked": 1835,
            "missing_found": 2,
            "recorded_seq": 2939,
            "session_id": "05918159f64842f1fe73e9e2157b2112",
            "start_last_seq": 0,
            "start_time": "Fri, 09 May 2014 15:14:18 GMT"
        }
    ],
    "ok": true,
    "replication_id_version": 3,
    "session_id": "05918159f64842f1fe73e9e2157b2112",
    "source_last_seq": 2939
    }
    ```



