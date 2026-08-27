/* Evolution Design · Secure Project Files v1
   All private R2 operations are authenticated through the Worker. */
(() => {
  'use strict';
  if (window.EvolutionProjectFiles) return;

  const WORKER = 'https://evolution-design-backend.evolutiongt01.workers.dev';

  async function token() {
    const user = window.__evolutionProjectFilesAuth?.currentUser;
    if (!user) throw new Error('Tu sesión ya no está activa.');
    return user.getIdToken();
  }

  async function request(path, options = {}) {
    const idToken = await token();
    const response = await fetch(`${WORKER}${path}`, {
      ...options,
      cache: 'no-store',
      headers: { ...(options.headers || {}), authorization: `Bearer ${idToken}` }
    });
    if (options.raw && response.ok) return response;
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      const error = new Error(body?.error || 'No se pudo completar la operación de archivos.');
      error.code = body?.code || `HTTP_${response.status}`;
      throw error;
    }
    return body;
  }

  async function upload({ ownerUid, projectId, folder, fileId, file, onProgress }) {
    if (!file) throw new Error('Archivo inválido.');
    const idToken = await token();
    const params = new URLSearchParams({ ownerUid, projectId, folder, fileId, fileName: file.name || 'archivo' });
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${WORKER}/project-files/upload?${params}`);
      xhr.setRequestHeader('authorization', `Bearer ${idToken}`);
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && onProgress) onProgress(event.loaded, event.total);
      };
      xhr.onerror = () => reject(new Error('No se pudo conectar con el servidor de archivos.'));
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
        if (xhr.status < 200 || xhr.status >= 300 || body?.ok === false) {
          const error = new Error(body?.error || 'No se pudo subir el archivo.');
          error.code = body?.code || `HTTP_${xhr.status}`;
          reject(error);
          return;
        }
        resolve(body);
      };
      xhr.send(file);
    });
  }

  async function objectBlob(key, { download = false, fileName = '' } = {}) {
    const params = new URLSearchParams({ key });
    if (download) params.set('download', '1');
    if (fileName) params.set('fileName', fileName);
    const response = await request(`/project-files/object?${params}`, { method: 'GET', raw: true });
    return response.blob();
  }

  async function objectURL(key) {
    return URL.createObjectURL(await objectBlob(key));
  }

  async function download(key, fileName = 'archivo') {
    const url = URL.createObjectURL(await objectBlob(key, { download: true, fileName }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  const remove = key => request('/project-files/delete', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key })
  });
  const removeProject = (ownerUid, projectId) => request('/project-files/delete-prefix', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerUid, projectId })
  });

  window.EvolutionProjectFiles = Object.freeze({ upload, objectBlob, objectURL, download, remove, removeProject });
})();
