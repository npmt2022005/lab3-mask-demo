import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createModelSwitcher} from '../model-switcher.mjs';
import {createApp} from '../server.mjs';

test('model selector releases old sessions, recovers failed loads and rejects paths',async()=>{
  let resident=0,maxResident=0,fail=true;const loaded=[];
  const load=async folder=>{
    if(folder==='model_yolo'&&fail){fail=false;throw new Error('load failed');}
    resident++;maxResident=Math.max(maxResident,resident);loaded.push(folder);
    return{labels:['Mask','No mask','Incorrect mask'],architecture:folder,modelId:folder,backend:'test',task:'multi-face-mask-detection',
      predict:async()=>({model_id:folder}),dispose:async()=>{resident--;}};
  };
  const model=await createModelSwitcher({load});
  try{
    assert.equal((await model.predict(Buffer.alloc(1),'nano')).model_key,'nano');
    await assert.rejects(model.predict(Buffer.alloc(1),'small'),/load failed/);
    assert.equal(resident,0);
    assert.equal((await model.predict(Buffer.alloc(1),'small')).model_id,'model_yolo');
    assert.equal((await model.predict(Buffer.alloc(1),'nano')).model_id,'model_yolo_nano');
    await assert.rejects(model.predict(Buffer.alloc(1),'../../other'),/Unknown model/);
    assert.equal(maxResident,1);assert.deepEqual(loaded,['model_yolo_nano','model_yolo','model_yolo_nano']);
  }finally{await model.dispose();}
  assert.equal(resident,0);
});

test('real API chooses nano/small per request and guards concurrent model changes',async()=>{
  const model=await createModelSwitcher(),server=createApp(model).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port,jpeg=await readFile('public/demo/multi-scene.jpg');
  const post=key=>fetch(base+'/predict?model='+key,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:jpeg});
  try{
    const health=await(await fetch(base+'/health')).json();
    assert.equal(health.default_model,'nano');assert.deepEqual(health.models.map(m=>m.id),['nano','small']);
    assert.equal((await post('arbitrary-folder')).status,400);
    const results=[];
    for(const key of ['nano','small','nano']){
      const response=await post(key);assert.equal(response.status,200);const data=await response.json();
      assert.equal(data.model_key,key);assert.ok(data.face_count>=2);assert.ok(data.server_ms>=data.inference_ms);
      results.push(data);
    }
    assert.equal(results[0].model_id,results[2].model_id);assert.notEqual(results[0].model_id,results[1].model_id);
    assert.ok(results[1].model_load_ms>0);assert.ok(results[2].model_load_ms>0);
    let release;const original=model.predict;model.predict=async(...args)=>{await new Promise(r=>{release=r});return original(...args)};
    const pending=post('small');
    while(!release)await new Promise(r=>setTimeout(r,5));
    assert.equal((await post('nano')).status,429);release();assert.equal((await pending).status,200);
  }finally{await new Promise(r=>server.close(r));await model.dispose();}
});
