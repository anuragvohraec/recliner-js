export interface Compare<K>{
    (k1: K, k2: K):number;
}

interface WeightsMap{
    [key: string]: number
}

export interface MapKindOfObjects{
    [key: string]: any
}

export interface FieldNamesMap{
    [key:string]: string
}


export class ComparatorIcing{
    constructor(public order: string , public nestedfieldsAsList: string[]){};
}

export interface ComparatorIcingMap{
    [key: string]: ComparatorIcing;
}

export class ComparatorCake{
    constructor(public compare: Compare<any>, public icingMap: ComparatorIcingMap){};
}


const weightsOfMap: WeightsMap = {
    "undefined":0,
    "null": 0,
    "number": 1,
    "string": 2,
    "array": 3,
    "object": 4
  };


export class JSObjectComparators{


static toType(obj: any): string {
    //@ts-ignore
    return ({}).toString.call(obj).match(/\s([a-zA-Z]+)/)[1].toLowerCase()
}

  
static coreTypeComparator(rt1: string, rt2:string):number{
    let t = weightsOfMap[rt1]-weightsOfMap[rt2];
    return t<0?-1:(t===0)?0:1;
 }

static genUnitSortHelper<T>( k1: T,  k2: T): number{
    let rt1 = JSObjectComparators.toType(k1);
    if(rt1==="number"){
        let t= ((k1 as unknown) as number)-((k2 as unknown) as number);
        return t<0?-1:(t===0)?0:1;
    }else{
        return ((k1 as unknown) as string).localeCompare((k2 as unknown) as string);
    }
  }
  
  
//   int revisionComparator(String k1, String k2){
//     var result =0;
  
//     //Type comparisons
//     var rt1 = k1.runtimeType.toString().split("<")[0];
//     var rt2 = k2.runtimeType.toString().split("<")[0];
//     result = coreTypeComparator(rt1, rt2);
//     if(result != 0 || (k1==null && k2==null)){
//       return result;
//     }
//     // if code has passed till here, this means: k1 and k2 are not nulls and have same generic Main type
//     int n1 = int.parse(k1.split("-")[0]);
//     int n2 = int.parse(k2.split("-")[0]);
//     return n1.compareTo(n2);
//   }
  
  //**k1 is always search field
  static coreComparator(k1:any, k2:any):number{
    let result =0;
  
    //Type comparisons
    let rt1 = JSObjectComparators.toType(k1);
    let rt2 = JSObjectComparators.toType(k2);
    result = JSObjectComparators.coreTypeComparator(rt1, rt2);
    if(result != 0 || (!k1 && !k2)){
      return result;
    }
  
    // if code has passed till here, this means: k1 and k2 are not nulls and have same generic Main type
    if(rt1 == "number" || rt1 == "string"){
      return JSObjectComparators.genUnitSortHelper(k1, k2);
    }
  
    //if code is here this means , its either a map or a list, as comparables: int, double, String have already been filtered above
    if(rt1=="array"){
      //do list comparison
      return JSObjectComparators.coreListComparator(k1,k2);
    }else{
      //do map comparison
      return JSObjectComparators.coreMapComparator(k1, k2);
    }
  }
  

  ///K1 is always the searched key
  static coreListComparator(k1: Array<any>, k2: Array<any>): number{
    let result =0;
    var l1 = k1.length;
    var l2 = k2.length;
  
    var max_loop = l1>l2?l2:l1;
    if(max_loop==0){
      return 0; //for empty list
    }
  
    for(let i=0;i<max_loop;i++){
      var t1  = k1[i];
      var t2 = k2[i];
      result = JSObjectComparators.coreComparator(t1, t2);
      if(result!=0){
        return result;
      }
    }
    let t = l1-l2;
    return t<0?-1:(t===0)?0:1;
  }
  
  ///k1 is always normalized search key
  static coreMapComparator(k1: MapKindOfObjects, k2: MapKindOfObjects):number{
    let result=0;
  
    if(Object.keys(k1).length == 0  && Object.keys(k2).length == 0){ //for empty maps
      return 0;
    }
  
    for(let key of Object.keys(k1)){
       let t1 = k1[key];
       let t2 = k2[key];
       result = JSObjectComparators.coreComparator(t1, t2);
       if(result!=0){
         return result;
       }
    }
  
    return this.genUnitSortHelper(Object.keys(k1).length, Object.keys(k2).length);
  }


  static _parseFieldNames(fieldNamesMap: FieldNamesMap): ComparatorIcingMap{
    let map: ComparatorIcingMap ={};
  
    for(let f of Object.keys(fieldNamesMap)){
        map[f]=new ComparatorIcing(fieldNamesMap[f].toLowerCase().trim(), f.split("."))
    }
    return map;
  }
  
  /**
   * Use it to bake fields name map.
   * 
   * Example fieldNamesMap = {"phone.mobile":"asc"}
   * @param fieldNamesMap 
   */
  static bakeAComparatorForIndexedFields(fieldNamesMap: FieldNamesMap): ComparatorCake{
    let icingMap: ComparatorIcingMap  = JSObjectComparators._parseFieldNames(fieldNamesMap);
    let compare: Compare<any> = (k1:any, k2:any)=>{
      let result=0;
      for(var key of Object.keys(icingMap)){
        let ci: ComparatorIcing = icingMap[key];
        result = JSObjectComparators._bakeANestedPropertyComparator(ci.nestedfieldsAsList)(k1,k2);
        if(result!=0){
          if(ci.order=="desc"){
            result*=-1;
          }
          return result;
        }
      }
      return result;
    };
    return new ComparatorCake(compare, icingMap);
  }
  
  static _bakeANestedPropertyComparator(fields: string[]): Compare<MapKindOfObjects> {
    return (k1: MapKindOfObjects, k2: MapKindOfObjects)=>{
      let t1=k1;
      let t2=k2;
      for(var f of fields){
        t1 = t1[f];
        t2 = t2[f];
        //either one of them is null
        //which implies one of them do not have a field
        if((!t1 || !t2) || (t1.runtimeType!=t2.runtimeType)){
          break;
        }
      }
      return JSObjectComparators.coreComparator(t1, t2);
    };
  }
  
  static bakeQueryComparatorMaster(icingMap: ComparatorIcingMap): Compare<MapKindOfObjects>  {
      return ( k1: MapKindOfObjects,  k2: MapKindOfObjects)=>{
          let result =0;
  
          if(k1.isEmpty)
            return 0;
  
  
          for(let nestedFieldsString of Object.keys(icingMap)){
                let t1 = k1;
                let t2 = k2;
                for(let prop of icingMap[nestedFieldsString].nestedfieldsAsList){
                  t1=t1[prop];
                  t2=t2[prop];
                  if(!t1 || !t2){
                    break;
                  }
                }
                if(!t1){
                  continue;
                }else{
                  result = JSObjectComparators.coreComparator(t1, t2);
                  if(result!=0){
                    return result;
                  }
                }
          }
  
          return result;
      };
  }
  
  static bakeQueryComparator(fields: string[]):  Compare<MapKindOfObjects>{
    return (k1: MapKindOfObjects, k2: MapKindOfObjects)=>{
      let result=0;
  
      if(k1.isEmpty && k2.isEmpty){ //for empty maps
        return 0;
      }
  
      for(var key of fields){
        var t1 = k1[key];
        var t2 = k2[key];
        if(!t1){
            continue;
        }else{
          result = JSObjectComparators.coreComparator(t1, t2);
          if(result!=0){
            return result;
          }
        }
      }
      return result;
    };
  }
  
  static coreMapKey1BiasedComparator(k1: MapKindOfObjects, k2: MapKindOfObjects):number{
    let result=0;
  
    if(k1.isEmpty && k2.isEmpty){ //for empty maps
      return 0;
    }
  
    for(var key of k1.keys){
      var t1 = k1[key];
      var t2 = k2[key];
      result = JSObjectComparators.coreComparator(t1, t2);
      if(result!=0){
        return result;
      }
    }
  
    return result;
  }
  
  
}

