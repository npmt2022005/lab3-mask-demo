import express from 'express';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createModelSwitcher } from './model-switcher.mjs';

export function createApp(classifier) {
  const app = express();
  app.disable('x-powered-by');
  // Lab API has no cookies or credentials. CORS permits pages served from ESP32 LAN IPs.
  const origins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origins.includes('*')) res.set('Access-Control-Allow-Origin', '*');
    else if (origins.includes(origin)) res.set('Access-Control-Allow-Origin', origin).vary('Origin');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url))));
  app.get('/health', (_req, res) => res.json({ ready: true, labels: classifier.labels,
    model_id: classifier.modelId, backend: classifier.backend, task: classifier.task || 'image-classification', architecture: classifier.architecture || 'Teachable Machine legacy', execution_location: process.env.EXECUTION_LOCATION || 'local',
    ...(classifier.models?{models:classifier.models,default_model:classifier.defaultModel}:{}) }));
  let busy = false;
  app.post('/predict', (req, res, next) => {
    if (!req.is('image/jpeg')) return res.status(415).json({ error: 'Send raw JPEG with Content-Type: image/jpeg' });
    req.receivedAt = performance.now(); next();
  }, express.raw({ type: 'image/jpeg', limit: '300kb' }), async (req, res) => {
    if (!req.body?.length) return res.status(400).json({ error: 'Empty image' });
    const model=req.query.model ?? classifier.defaultModel;
    if(classifier.models&&!classifier.models.some(m=>m.id===model))return res.status(400).json({error:'Choose model nano or small'});
    if (busy) return res.status(429).json({ error: 'Inference busy; retry later' });
    busy = true;
    try {
      const result = await classifier.predict(req.body,model);
      res.json({ request_id: randomUUID(), ...result, server_ms: performance.now() - req.receivedAt,
        execution_location: process.env.EXECUTION_LOCATION || 'local' });
    } catch (error) {
      console.error('Prediction failed:', error.message);
      res.status(422).json({ error: 'Cannot decode or infer this JPEG' });
    } finally { busy = false; }
  });
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.status === 413 ? 'Image exceeds 300 KB' : 'Request failed' }));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const classifier = await createModelSwitcher();
  const port = Number(process.env.PORT || 8080);
  createApp(classifier).listen(port, '0.0.0.0', () => console.log(`Lab3 API ready on :${port}; labels=${classifier.labels.join(', ')}`));
}
