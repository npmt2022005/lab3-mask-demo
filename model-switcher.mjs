import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {loadClassifier} from './inference.mjs';

// Called only inside the API's single-request lock. Never keep both sessions resident.
export async function createModelSwitcher({load=loadClassifier,defaultModel='nano',
  folders={nano:'model_yolo_nano',small:'model_yolo'}}={}) {
  if(!Object.hasOwn(folders,defaultModel))throw new Error('Invalid default model');
  const models=[];
  for(const [id,folder] of Object.entries(folders)){
    const metadata=JSON.parse(await readFile(folder+'/metadata.json','utf8'));
    models.push({id,name:id==='nano'?'YOLOv8n · Nano':'YOLOv8s · Small',
      architecture:metadata.architecture,image_size:metadata.image_size});
  }
  let active=await load(folders[defaultModel]),key=defaultModel;
  let snapshot=active;
  const proxy={models,defaultModel,
    async predict(jpeg,requested=defaultModel){
      if(!Object.hasOwn(folders,requested))throw new Error('Unknown model');
      let modelLoadMs=0;
      if(!active||requested!==key){
        const started=performance.now();
        const old=active;active=null;snapshot={labels:snapshot.labels,modelId:snapshot.modelId,
          backend:snapshot.backend,task:snapshot.task,architecture:snapshot.architecture};
        await old?.dispose();
        active=await load(folders[requested]);key=requested;snapshot=active;
        modelLoadMs=performance.now()-started;
      }
      return{...await active.predict(jpeg),model_key:requested,model_load_ms:modelLoadMs};
    },
    async dispose(){const old=active;active=null;await old?.dispose();}
  };
  for(const property of ['labels','modelId','backend','task','architecture'])
    Object.defineProperty(proxy,property,{get:()=>snapshot[property]});
  return proxy;
}
