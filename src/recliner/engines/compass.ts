export interface PathParams{
    [key:string]:string;
}

export interface PathDirection{
    path_params: PathParams;
    matched_pattern:string;
    parent_matches: string[];
}

export interface PathTypes{
    value?: string,
    plain?: PathNames;
    parameterized?: PathNames;
}

export interface PathNames{
    [key:string]:PathTypes;
}

// export interface PathTree{
//     [key:number]:PathTypes
// }

export class Compass {
    private path_tree:PathTypes ={};

    /**
     * use to define new paths, to later find them with find function.
     * 
     * you can use path params with a colon. Only simple path patterns supported.
     * @param path_pattern 
     */
    define(path_pattern: string){
        
        const parts = path_pattern.split("/");


        //this happens when path starts with '/', which creates a blank string, we will simply remove it
        while(parts[0]===""){
            parts.shift();
        }

        //for root case
        if(parts.length==0){
            this.path_tree.value="/";
            return;
        }

        //First key wll be number of parts
        let s=this.path_tree;//start node
        let c=0;
        for(let p of parts){
            const isPlain = !(p.startsWith(":"));
            
            let t : PathNames|undefined; //type

            if(isPlain){
                t=s.plain;
            }else{
                t=s.parameterized;
                p=p.slice(1);
            }
            
            if(!t){
                if(isPlain){
                    s.plain={};
                    t=s.plain;
                }else{
                    s.parameterized={};
                    t=s.parameterized;
                }
            }

            const v = t[p];//value
            const value_type=typeof ((v && v.value)?v.value:v);
            if(value_type === "string" && c===parts.length-1){
                return;
            }else if(value_type === "undefined"){
                if(parts.length-1===c){
                    //is last element;
                    t[p]={value:path_pattern};
                    return;
                }else{
                    t[p]={};
                    s=t[p];
                }
            }else{
                s=t[p];
            }
            c++;
        }
    }

    /**
     * Used to find the defined path, if not found it simply returns undefined.
     * 
     * if found the result object has two keys path_params object containing 
     * path parameter and their value, and a matched_pattern key, which signify
     * which path it has matched against
     * @param url_path 
     */
    find(url_path: string):PathDirection|undefined{
        const parts = url_path.split("/");


        //this happens when path starts with '/', which creates a blank string,
        // we will simply remove it
        while(parts[0]===""){
            parts.shift();
        }
        //for root
        if(parts.length==0){
            if(this.path_tree.value){
                return {path_params:{},matched_pattern:"/",parent_matches:[]};
            }else{
                return;
            }
        }
        let s:PathTypes = this.path_tree;
        //no entry with the given length simply return
        if(!s){
            return;
        }else{
            let path_params:PathParams={};
            let parent_matches: string[] =[];
            if(s.value){
                parent_matches.push("/");
            }
            return this._find(0,parts,s, path_params, parent_matches);
        }
    }

    _find(d:number,parts:string[],s:PathTypes, path_params:PathParams, parent_matches: string[]):PathDirection|undefined{
        let p=parts[d];
        let t: string|PathTypes|undefined = s.plain?s.plain[p]:undefined;
        let v = (t && t.value)?t.value:undefined;
        if(v){
            if(typeof v==='string'){
                if(d === parts.length-1){
                    return {path_params, matched_pattern:v,parent_matches:parent_matches};
                }else{
                    d++;
                    parent_matches.push(v);
                    return this._find(d,parts,t!,path_params,parent_matches);
                }
            }else{
                d++;
                return this._find(d,parts,t!,path_params, parent_matches);
            }
        }else if(t){
            d++;
            return this._find(d,parts,t!,path_params, parent_matches);
        }else if(s.parameterized){
            for(let i of Object.keys(s.parameterized)){
                t= s.parameterized[i];
                let v = (t && t.value)?t.value:undefined;
                path_params[i]=p;
                if(typeof v==='string'){
                    if(d===parts.length-1){
                        return {path_params, matched_pattern:v, parent_matches: parent_matches};
                    }else{
                        d++;
                        parent_matches.push(v);
                        return this._find(d,parts,t!,path_params,parent_matches);
                    }
                }else{
                    //t is either undefined or object
                    d++;
                    let z = this._find(d,parts,t,path_params,parent_matches);
                    if(z){
                        return z;
                    }else{
                        path_params={};
                        d--;
                    }
                }
            }
        }
    }
}

interface Probe{
    part:string;
    depth:number;
}

/**
 * path1: /name_of/:usrname/info
 * path2: /:docid/meta/:param_name
 * path3: /:pirates/of/:sea
{
    3:{
        parameterized:{
            "docid":{
                plain:{
                    meta:{
                        parameterized:{
                           "param_name":"/:docid/meta/:param_name" 
                        }
                    }
                }
            },
            "pirates":{
                plain:{
                    "of":{
                        parameterized:{
                            "sea": "/:pirates/of/:sea"
                        }
                    }
                }
            }
        },
        plain:{
            name_of:{
                parameterized:{
                    "usrname":{
                        plain:{
                            info: "/name_of/:usrname/info"
                        }
                    }
                }
            }
        }
    }
}
*/
