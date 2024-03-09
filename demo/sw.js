import {Recliner} from '/dist/index.js';

const ONE_MB=1000_000;
const recliner = new Recliner(24,{
    "video/webm":ONE_MB,
});//create instance

self.addEventListener("fetch",(e)=>{
    const url_path = Recliner.getPathFromUrl(e.request);
    if(url_path.startsWith("/recliner")){
        e.respondWith(recliner.process(e.request));
    }else{
        e.respondWith(fetch(e.request));
    }
});