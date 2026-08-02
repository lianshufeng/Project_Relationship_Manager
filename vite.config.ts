import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const storeDirectory = path.resolve(process.cwd(), 'store');
const storeFile = path.join(storeDirectory, 'project-relationship-data.json');
const emptyProjectData = {
  schemaVersion: '1.0',
  dataRevision: 16,
  project: { id: 'project-001', name: '未命名项目部', shortName: '项目部', address: '', description: '', icon: 'BankOutlined' },
  teams: [],
  positions: [],
  persons: [],
  products: [],
  deviceTypes: [],
  devices: [],
  areas: [],
  relations: [],
  settings: { layoutDirection: 'LR', positions: {} },
};

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 10 * 1024 * 1024) throw new Error('数据文件不能超过 10MB');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function writeStoreFile(data: unknown) {
  await mkdir(storeDirectory, { recursive: true });
  const temporaryFile = `${storeFile}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8' });
  await rename(temporaryFile, storeFile);
}

async function handleStoreApi(request: IncomingMessage, response: ServerResponse, next: () => void) {
  const pathname = request.url?.split('?')[0];
  if (pathname !== '/api/project-data') return next();

  try {
    if (request.method === 'GET') {
      try {
        const content = await readFile(storeFile, 'utf8');
        return sendJson(response, 200, JSON.parse(content));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          await writeStoreFile(emptyProjectData);
          return sendJson(response, 200, emptyProjectData);
        }
        return sendJson(response, 500, { message: '读取数据文件失败' });
      }
    }

    if (request.method === 'PUT') {
      const data: unknown = JSON.parse(await readRequestBody(request));
      if (!data || typeof data !== 'object' || (data as { schemaVersion?: string }).schemaVersion !== '1.0') {
        return sendJson(response, 400, { message: '数据结构校验失败' });
      }
      await writeStoreFile(data);
      return sendJson(response, 200, { message: '保存成功', path: './store/project-relationship-data.json' });
    }

    return sendJson(response, 405, { message: '不支持的请求方法' });
  } catch (error) {
    return sendJson(response, 500, { message: error instanceof Error ? error.message : '本地数据操作失败' });
  }
}

const localStorePlugin = {
  name: 'local-project-store',
  configureServer(server: { middlewares: { use: (handler: typeof handleStoreApi) => void } }) {
    server.middlewares.use(handleStoreApi);
  },
  configurePreviewServer(server: { middlewares: { use: (handler: typeof handleStoreApi) => void } }) {
    server.middlewares.use(handleStoreApi);
  },
};

export default defineConfig({
  plugins: [react(), localStorePlugin],
  preview: {
    allowedHosts: ['platform.dy.kuixingkeji.com'],
  },
});
