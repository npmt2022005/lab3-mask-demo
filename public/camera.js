'use strict';
const $ = id => document.getElementById(id);
const video = $('preview'), canvas = $('resultCanvas'), ctx = canvas.getContext('2d');
const labels = { Mask: 'Đeo đúng', 'No mask': 'Không đeo', 'Incorrect mask': 'Đeo sai', Unknown: 'Chưa rõ' };
const colors = { Mask: '#0c7168', 'No mask': '#ba3a42', 'Incorrect mask': '#986700', Unknown: '#687783' };
let stream = null, photo = null, running = false, processing = false, opening = false;
let generation = 0, cameraGeneration = 0, previewSession = 0, activeRequest = null;
let checkedBase = '', health = null, lastResult = null;
const frameSamples = [], faceSamples = [];
let datasetCapturing = false, datasetCount = 0;
$('apiUrl').value = localStorage.getItem('lab3CameraApi') || location.origin;
if(['nano','small'].includes(localStorage.getItem('lab3CameraModel')))$('modelSelect').value=localStorage.getItem('lab3CameraModel');

function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function updateControls() {
  $('modelSelect').disabled=!health?.models;
  $('captureDataset').disabled = !stream || datasetCapturing;
  const source = Boolean(stream || photo);
  $('openCamera').disabled = opening;
  $('closeCamera').disabled = !stream && !opening;
  $('predictOnce').disabled = !source || processing || running;
  $('startLive').disabled = !stream || processing || running;
  $('stopLive').disabled = !running && !processing;
  $('busyBadge').hidden = !processing;
  $('saveImage').disabled = !lastResult;
  $('exportFrames').disabled = !frameSamples.length;
  $('exportFaces').disabled = !faceSamples.length;
  $('sampleCount').textContent = frameSamples.length ? `${frameSamples.length} ảnh · ${faceSamples.length} lượt khuôn mặt trong phiên. Xuất CSV trước khi đóng trang.` : 'Chưa có số đo trong phiên này.';
}
function baseUrl() {
  const url = new URL($('apiUrl').value.trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Địa chỉ API phải bắt đầu bằng http:// hoặc https://.');
  if (location.protocol === 'https:' && url.protocol !== 'https:') throw new Error('Trang HTTPS cần kết nối đến API HTTPS.');
  return url.href.replace(/\/+$/, '');
}
async function fetchJson(url, options = {}, timeout = 30000, isPrediction = false) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  if (isPrediction) activeRequest = controller;
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch (_) { throw new Error('Địa chỉ này không trả dữ liệu API. Kiểm tra URL và cửa sổ chạy server.'); }
    if (!response.ok) throw new Error(response.status === 429 ? 'Server đang bận, thử lại sau vài giây.' : data.error || `HTTP ${response.status}`);
    return data;
  } finally { clearTimeout(timer); if (activeRequest === controller) activeRequest = null; }
}
async function connect() {
  const base = baseUrl();
  if (health && checkedBase === base) return { base, health };
  $('apiBadge').textContent = 'Đang kiểm tra';
  try {
    const data = await fetchJson(base + '/health', {}, 90000);
    if (!data.ready || data.task !== 'multi-face-mask-detection') throw new Error('Cần API nhiều khuôn mặt của bản Lab 3 mới.');
    if (base !== baseUrl()) throw new Error('Địa chỉ API đã thay đổi. Kiểm tra lại kết nối.');
    health = data; checkedBase = base; localStorage.setItem('lab3CameraApi', base);
    $('apiBadge').textContent = data.execution_location === 'cloud' ? 'Cloud' : 'Local';
    const selected=data.models?.find(m=>m.id===$('modelSelect').value);
    $('apiInfo').textContent = `${selected?.architecture||data.architecture} · ${data.execution_location === 'cloud' ? 'Xử lý trên Cloud' : 'Xử lý tại server local'}`;
    $('modelArchitecture').textContent = 'LAB 3 / ' + (selected?.architecture||data.architecture);
    updateControls();
    return { base, health: data };
  } catch (e) { $('apiBadge').textContent = 'Chưa kết nối'; $('apiInfo').textContent = 'Kiểm tra server và địa chỉ API.'; throw e; }
}
async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const previous = $('cameraDevice').value;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  $('cameraDevice').replaceChildren(new Option('Camera mặc định', ''));
  devices.forEach((d, i) => $('cameraDevice').append(new Option(d.label || `Camera ${i + 1}`, d.deviceId)));
  if (devices.some(d => d.deviceId === previous)) $('cameraDevice').value = previous;
}
function stopRecognition() {
  running = false; generation++; activeRequest?.abort(); updateControls();
}
function closeCamera(showMessage = true) {
  stopRecognition(); cameraGeneration++; opening = false;
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = null; video.srcObject = null; video.hidden = true;
  $('cameraStatus').textContent = 'Camera đã tắt. Ảnh kết quả cuối vẫn được giữ lại.';
  if (showMessage) message('Đã tắt camera. Có thể mở lại camera hoặc chọn ảnh.');
  updateControls();
}
function cameraError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Quyền camera bị chặn. Cho phép Camera trong cài đặt trang, rồi bấm Mở camera. Dùng địa chỉ localhost hoặc HTTPS.';
  if (error.name === 'NotFoundError') return 'Không tìm thấy webcam. Kết nối camera USB hoặc dùng nút chọn ảnh.';
  if (error.name === 'NotReadableError') return 'Không mở được webcam. Đóng ứng dụng khác đang dùng camera rồi thử lại.';
  return error.message || 'Không mở được camera.';
}
async function openCamera() {
  closeCamera(false); const ticket = ++cameraGeneration; opening = true; updateControls();
  let acquired;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Mở trang bằng http://localhost:8090 hoặc HTTPS để dùng webcam.');
    $('cameraStatus').textContent = 'Đang chờ quyền truy cập camera…';
    const device = $('cameraDevice').value;
    acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
      width: { ideal: 1280 }, height: { ideal: 720 }, ...(device ? { deviceId: { exact: device } } : {})
    } });
    if (ticket !== cameraGeneration) { acquired.getTracks().forEach(t => t.stop()); return; }
    stream = acquired; video.srcObject = acquired; await video.play();
    if (ticket !== cameraGeneration) { acquired.getTracks().forEach(t => t.stop()); return; }
    if (photo) { photo.close(); photo = null; }
    video.hidden = false; previewSession++;
    lastResult = null; clearDisplayedResults();
    if (video.videoWidth && video.videoHeight) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.drawImage(video, 0, 0);
      canvas.hidden = false; $('empty').hidden = true;
    }
    $('sourceName').textContent = acquired.getVideoTracks()[0]?.label || 'Webcam';
    $('cameraStatus').textContent = 'Camera đang mở. Bấm Nhận diện 1 ảnh hoặc Bắt đầu liên tục.';
    acquired.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (stream === acquired) { closeCamera(false); message('Camera đã ngắt kết nối. Kiểm tra dây hoặc chọn lại camera.', true); }
    });
    await listCameras(); message('Webcam sẵn sàng. Chọn chế độ nhận diện.');
  } catch (e) {
    acquired?.getTracks().forEach(t => t.stop());
    if (ticket === cameraGeneration) { stream = null; video.srcObject = null; video.hidden = true; message(cameraError(e), true); $('cameraStatus').textContent = cameraError(e); }
  } finally { if (ticket === cameraGeneration) opening = false; updateControls(); }
}
async function usePhoto(blob, name) {
  closeCamera(false); const ticket = generation;
  const image = await createImageBitmap(blob);
  if (ticket !== generation) { image.close(); return; }
  if (photo) photo.close(); photo = image; previewSession++;
  const width = Math.min(1280, image.width), scale = width / image.width;
  canvas.width = width; canvas.height = Math.max(1, Math.round(image.height * scale));
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  canvas.hidden = false; $('empty').hidden = true; lastResult = null;
  $('sourceName').textContent = name; clearDisplayedResults();
  message('Ảnh đã mở. Bấm Nhận diện 1 ảnh để xem kết quả.'); updateControls();
}
function clearDisplayedResults() {
  for (const id of ['countMask','countNoMask','countIncorrect','countUnknown']) $(id).textContent = '—';
  $('faceTotal').textContent = 'Chưa nhận diện ảnh này';
  $('faceRows').replaceChildren();
  for (const id of ['inferenceTime','roundTripTime','totalTime']) $(id).textContent = '—';
}
async function sample() {
  stopRecognition(); const ticket = generation;
  try {
    const response = await fetch('/demo/multi-scene.jpg');
    if (!response.ok) throw new Error('Không tải được ảnh mẫu. Có thể chọn ảnh từ máy tính.');
    const blob = await response.blob(); if (ticket !== generation) return;
    await usePhoto(blob, 'Ảnh mẫu công khai · nhiều người');
  } catch (e) { message(e.message, true); }
}
function jpegOf(target, quality) { return new Promise((resolve, reject) => target.toBlob(b => b ? resolve(b) : reject(new Error('Không tạo được ảnh JPEG.')), 'image/jpeg', quality)); }
async function capture() {
  if (!stream && !photo) throw new Error('Mở camera hoặc chọn ảnh trước.');
  const source = stream ? video : photo;
  const width = stream ? video.videoWidth : photo.width, height = stream ? video.videoHeight : photo.height;
  if (!width || !height) throw new Error('Camera chưa có hình. Chờ vài giây rồi thử lại.');
  // Continuous mode sends smaller frames to cut upload and decode time on the free CPU.
  const target = document.createElement('canvas'), scale = Math.min(1, (running ? 640 : 1280) / Math.max(width, height));
  target.width = Math.max(1,Math.round(width*scale)); target.height = Math.max(1,Math.round(height*scale));
  target.getContext('2d').drawImage(source,0,0,target.width,target.height);
  for (const quality of [.9,.75,.55,.35]) {
    const blob = await jpegOf(target, quality);
    if (blob.size <= 300*1024) return { blob, frame: target };
  }
  throw new Error('Ảnh vượt 300 KB. Thử ảnh đơn giản hoặc nhỏ hơn.');
}
function drawDetections(result) {
  const sx=canvas.width/result.image.width,sy=canvas.height/result.image.height;
  ctx.lineWidth=Math.max(2,canvas.width/400);ctx.font=`600 ${Math.max(10,canvas.width/65)}px Segoe UI, Arial`;
  for(const d of result.detections) {
    const x=d.box.x*sx,y=d.box.y*sy,w=d.box.width*sx,h=d.box.height*sy;
    const text=`#${d.id} ${labels[d.label] || d.label}`;
    ctx.strokeStyle=colors[d.label]||colors.Unknown;ctx.strokeRect(x,y,w,h);
    const fontHeight=Math.max(16,canvas.width/50),labelWidth=Math.min(canvas.width,ctx.measureText(text).width+10);
    const tx=Math.min(x,canvas.width-labelWidth),ty=Math.max(0,y-fontHeight);
    ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(tx,ty,labelWidth,fontHeight);
    ctx.fillStyle='white';ctx.fillText(text,tx+5,ty+fontHeight-4);
  }
}
function showResult(frame, result, rows) {
  // In continuous mode paintLive() owns the canvas, so results only update the overlay data.
  if(!(running&&stream)){canvas.width=frame.width;canvas.height=frame.height;ctx.drawImage(frame,0,0);drawDetections(result);}
  canvas.hidden=false;$('empty').hidden=true;
  const c=result.counts;
  $('countMask').textContent=c.Mask;$('countNoMask').textContent=c['No mask'];
  $('countIncorrect').textContent=c['Incorrect mask'];$('countUnknown').textContent=c.Unknown;
  $('faceTotal').textContent=`${result.face_count} mặt phát hiện${result.truncated?' · giới hạn 100 mặt':''}`;
  $('faceRows').replaceChildren();
  if(!rows.length) {
    const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=4;cell.className='empty-row';cell.textContent='Không phát hiện khuôn mặt trong ảnh này.';row.append(cell);$('faceRows').append(row);
  }
  for(const row of rows) {
    const tr=document.createElement('tr');
    const id=document.createElement('td');id.textContent='#'+row.face_id;
    const name=document.createElement('td'),badge=document.createElement('span');badge.className='status-label';badge.style.color=colors[row.label];badge.textContent=labels[row.label]||row.label;name.append(badge);
    const score=document.createElement('td');score.textContent=(row.probability*100).toFixed(1)+'%';
    const truth=document.createElement('td'),select=document.createElement('select');select.setAttribute('aria-label','Nhãn thực tế mặt '+row.face_id);
    for(const value of ['',...Object.keys(labels).filter(l=>l!=='Unknown'),'Not a face'])select.append(new Option(value==='Not a face'?'Không phải mặt':labels[value]||'Chưa gán',value));
    select.onchange=()=>{row.truth=select.value;};truth.append(select);tr.append(id,name,score,truth);$('faceRows').append(tr);
  }
  lastResult=result;
}
async function recognize(ticket) {
  const { base, health: info }=await connect();
  if(ticket!==generation)return;
  const t0=performance.now(),source=stream?'webcam':'uploaded_image';
  const {blob,frame}=await capture(),t1=performance.now();
  if(ticket!==generation)return;
  const requestedModel=info.models?$('modelSelect').value:null;
  const result=await fetchJson(base+'/predict'+(requestedModel?'?model='+encodeURIComponent(requestedModel):''),{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob},90000,true);
  const t2=performance.now();
  if(ticket!==generation)return;
  if(requestedModel&&result.model_key!==requestedModel)throw new Error('API trả kết quả của model khác.');
  if(!Array.isArray(result.detections)||!result.image||!result.counts||!Number.isFinite(result.inference_ms))throw new Error('API trả kết quả không hợp lệ.');
  const timestamp=new Date().toISOString();
  const rows=result.detections.map(d=>({timestamp,source,request_id:result.request_id,model_id:result.model_id,
    api_url:base,execution_location:result.execution_location,model_key:result.model_key||'',architecture:result.architecture,face_id:d.id,label:d.label,truth:'',probability:d.probability,
    face_score:d.face_score,...d.box}));
  showResult(frame,result,rows);faceSamples.push(...rows);
  $('modelArchitecture').textContent='LAB 3 / '+result.architecture;
  $('apiInfo').textContent=result.architecture+' · '+(result.execution_location==='cloud'?'Xử lý trên Cloud':'Xử lý tại server local');
  await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  const entry={timestamp,source,session:previewSession,first_request:(result.model_load_ms||0)>0||!frameSamples.some(s=>s.session===previewSession&&s.api_url===base&&s.model_id===result.model_id),
    model_key:result.model_key||'',architecture:result.architecture,model_load_ms:result.model_load_ms||0,
    request_id:result.request_id,model_id:result.model_id,api_url:base,execution_location:result.execution_location||info.execution_location,
    face_count:result.face_count,mask_count:result.counts.Mask,no_mask_count:result.counts['No mask'],incorrect_count:result.counts['Incorrect mask'],unknown_count:result.counts.Unknown,
    capture_ms:t1-t0,detector_ms:result.detector_ms,classification_ms:result.classification_ms,preprocess_ms:result.preprocess_ms,
    inference_ms:result.inference_ms,server_ms:result.server_ms,round_trip_ms:t2-t1,end_to_end_ms:performance.now()-t0};
  frameSamples.push(entry);
  $('inferenceTime').textContent=entry.inference_ms.toFixed(1)+' ms';$('roundTripTime').textContent=entry.round_trip_ms.toFixed(1)+' ms';$('totalTime').textContent=entry.end_to_end_ms.toFixed(1)+' ms';
  message(result.face_count?`Đã nhận diện ${result.face_count} khuôn mặt.${result.counts.Unknown?' Có mặt chưa đủ độ tin cậy.':''}`:'Không tìm thấy mặt. Thử đứng gần hơn, nhìn thẳng và tăng ánh sáng.');
  updateControls();
}
async function once() {
  if(processing||running)return;
  const ticket=++generation;processing=true;updateControls();
  try{await recognize(ticket);}catch(e){if(ticket===generation)message(e.name==='AbortError'?'Yêu cầu quá thời gian, kiểm tra server rồi thử lại.':e.message,true);}
  finally{processing=false;updateControls();}
}
function paintLive(ticket) {
  if(!running||!stream||ticket!==generation)return;
  if(video.videoWidth&&video.videoHeight){
    if(canvas.width!==video.videoWidth||canvas.height!==video.videoHeight){canvas.width=video.videoWidth;canvas.height=video.videoHeight;}
    ctx.drawImage(video,0,0);
    if(lastResult)drawDetections(lastResult);
    canvas.hidden=false;$('empty').hidden=true;
  }
  requestAnimationFrame(()=>paintLive(ticket));
}
async function live() {
  if(processing||running||!stream)return;
  running=true;const ticket=++generation;lastResult=null;updateControls();
  paintLive(ticket);
  try {
    while(running&&stream&&ticket===generation){
      const cycleStarted=performance.now();
      processing=true;updateControls();
      try{await recognize(ticket);}catch(e){if(ticket===generation){message(e.name==='AbortError'?'Yêu cầu quá thời gian. Kiểm tra API rồi chạy lại.':e.message,true);running=false;}}
      finally{processing=false;updateControls();}
      // Cap at 6 requests/sec without adding 200 ms to every slow inference.
      // Await each response before capturing again: no queue of stale webcam frames.
      if(running&&ticket===generation)await new Promise(resolve=>setTimeout(resolve,Math.max(0,1000/6-(performance.now()-cycleStarted))));
    }
  }finally{if(ticket===generation){running=false;processing=false;}updateControls();}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function captureDataset() {
  if (!stream || datasetCapturing) return;
  const state = $('datasetLabel').value;
  if (!['no_mask','hand_cover_no_mask','mask_correct','mask_incorrect'].includes(state)) return;
  datasetCapturing = true; updateControls();
  try {
    // Draw the live video into a separate canvas: never copy resultCanvas overlays.
    const width = video.videoWidth, height = video.videoHeight;
    if (!width || !height) throw new Error('Camera chưa có hình. Chờ một chút rồi chụp lại.');
    const raw = document.createElement('canvas'); raw.width = width; raw.height = height;
    raw.getContext('2d').drawImage(video, 0, 0, width, height);
    const blob = await jpegOf(raw, .95);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${state}_${stamp}_${++datasetCount}.jpg`;
    download(blob, name);
    $('datasetStatus').textContent = `Đã yêu cầu tải ${datasetCount} ảnh. Ảnh vừa chụp: ${name}. Kiểm tra mục Tải xuống của trình duyệt.`;
  } catch (e) { $('datasetStatus').textContent = 'Không chụp được: ' + e.message; }
  finally { datasetCapturing = false; updateControls(); }
}
$('captureDataset').onclick = captureDataset;
function exportCsv(rows,name){
  if(!rows.length)return;
  const keys=Object.keys(rows[0]),cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv='\ufeff'+[keys,...rows.map(r=>keys.map(k=>r[k]))].map(row=>row.map(cell).join(',')).join('\r\n');
  download(new Blob([csv],{type:'text/csv;charset=utf-8'}),name);
}
$('openCamera').onclick=openCamera;$('closeCamera').onclick=()=>closeCamera();
$('modelSelect').onchange=()=>{
  stopRecognition();lastResult=null;clearDisplayedResults();
  const source=stream?video:photo;
  if(source){ctx.drawImage(source,0,0,canvas.width,canvas.height);}
  const selected=health?.models?.find(m=>m.id===$('modelSelect').value);
  localStorage.setItem('lab3CameraModel',$('modelSelect').value);
  $('modelArchitecture').textContent='LAB 3 / '+(selected?.architecture||$('modelSelect').value);
  if(selected)$('apiInfo').textContent=selected.architecture+' · '+(health.execution_location==='cloud'?'Xử lý trên Cloud':'Xử lý tại server local');
  message('Đã chọn '+(selected?.name||$('modelSelect').value)+'. Bấm nhận diện để chạy; lần đầu có thể cần chờ nạp model.');
  updateControls();
};
$('cameraDevice').onchange=()=>{if(stream)openCamera();};
$('predictOnce').onclick=once;$('startLive').onclick=live;
$('stopLive').onclick=()=>{stopRecognition();message('Đã dừng nhận diện, giữ ảnh kết quả cuối. Camera vẫn mở; bấm Tắt camera để ngắt.');};
$('imageFile').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>20*1024*1024)throw new Error('Chọn ảnh nhỏ hơn 20 MB.');await usePhoto(file,file.name);}catch(e){message('Không mở được ảnh: '+e.message,true);}finally{event.target.value='';}
};
$('sampleButton').onclick=sample;$('sampleAgain').onclick=sample;
$('connectApi').onclick=async()=>{stopRecognition();health=null;try{await connect();message('API đã sẵn sàng. Mở camera hoặc chọn ảnh để bắt đầu.');}catch(e){message(e.message,true);}};
$('apiUrl').oninput=()=>{stopRecognition();health=null;checkedBase='';$('apiBadge').textContent='Cần kiểm tra lại';};
$('saveImage').onclick=async()=>{if(lastResult)download(await jpegOf(canvas,.92),'lab3-webcam-result.jpg');};
$('exportFrames').onclick=()=>exportCsv(frameSamples,'lab3-webcam-measurements.csv');
$('exportFaces').onclick=()=>exportCsv(faceSamples,'lab3-webcam-faces.csv');
addEventListener('pagehide',()=>{generation++;activeRequest?.abort();stream?.getTracks().forEach(t=>t.stop());photo?.close();});
listCameras().catch(()=>{});
connect().then(()=>message('Sẵn sàng. Mở camera hoặc chọn ảnh để bắt đầu.')).catch(e=>message('Chưa kết nối được API. Kiểm tra cửa sổ server và địa chỉ API. '+e.message,true));
updateControls();
