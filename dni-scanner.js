(async () => {
  const old = window.__dniScannerPersistent;
  if (old) { old.open(); return; }

  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const state = { stream: null, reader: null, active: false, closed: false, session: 0, preparing: null };
  const css = (el, style) => { el.style.cssText = style; return el; };
  const button = css(document.createElement('button'), 'position:absolute;right:6px;top:50%;transform:translateY(-50%);z-index:2;width:30px;height:30px;display:grid;place-items:center;background:transparent;color:inherit;border:0;border-radius:6px;padding:0;font:19px Arial;cursor:pointer;touch-action:manipulation');
  button.type = 'button'; button.title = 'Escanear DNI'; button.setAttribute('aria-label', 'Escanear DNI');
  button.textContent = '📷'; button.disabled = true;
  function mountButton() {
    const input = document.querySelector('input[name="name"]');
    const wrapper = input?.closest('.MuiInputBase-root') || input?.parentElement;
    if (!wrapper) return;
    if (getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative';
    if (button.parentElement !== wrapper) wrapper.appendChild(button);
    input.style.paddingRight = '42px';
  }
  const panel = css(document.createElement('div'), 'position:fixed;inset:0;z-index:2147483647;background:#111e;color:white;display:none;align-items:center;justify-content:center;flex-direction:column;gap:12px;font:16px Arial');
  const frame = css(document.createElement('div'), 'position:relative;width:min(96vw,900px);max-height:75dvh;overflow:hidden');
  const video = css(document.createElement('video'), 'display:block;width:100%;max-height:75dvh;object-fit:contain');
  video.autoplay = true; video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');
  const guide = css(document.createElement('div'), 'position:absolute;left:10%;top:39%;width:80%;height:22%;border:3px solid #35e69b;box-sizing:border-box;pointer-events:none');
  const status = document.createElement('div'); status.textContent = 'Preparando…';
  const close = document.createElement('button'); close.textContent = 'Cerrar visor'; close.style.cssText = 'padding:8px 18px;cursor:pointer';
  const shutdown = css(document.createElement('button'), 'position:fixed;right:12px;bottom:calc(70px + env(safe-area-inset-bottom, 0px));z-index:2147483646;background:#444;color:white;border:0;border-radius:8px;padding:8px 12px;font:13px Arial;cursor:pointer');
  shutdown.textContent = 'Apagar escáner';
  frame.append(video, guide); panel.append(frame, status, close); document.body.append(shutdown, panel); mountButton();
  const mountObserver = new MutationObserver(() => { if (!state.closed) mountButton(); });
  mountObserver.observe(document.body, { childList: true, subtree: true });

  function hide() {
    state.active = false;
    state.session++;
    panel.style.display = 'none';
    if (mobile) { state.stream?.getTracks().forEach(t => t.stop()); state.stream = null; video.srcObject = null; }
  }
  function dispose() {
    if (state.closed) return;
    state.closed = true; hide();
    state.stream?.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    mountObserver.disconnect(); button.remove(); shutdown.remove(); panel.remove();
    document.removeEventListener('keydown', onKey);
    delete window.__dniScannerPersistent;
  }
  function onKey(e) { if (e.key === 'Escape' && state.active) hide(); }
  document.addEventListener('keydown', onKey);
  close.onclick = hide; shutdown.onclick = dispose;

  function fill(selector, value) {
    const input = document.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) throw Error('No existe ' + selector);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function open() {
    if (state.closed || state.active) return;
    button.disabled = true;
    if (!state.reader || !state.stream?.active) {
      status.textContent = 'Reiniciando cámara…';
      panel.style.display = 'flex';
      try { await prepare(); } catch (e) { status.textContent = 'Error: ' + e.message; button.disabled = false; console.error(e); return; }
      if (state.closed) return;
    }
    button.disabled = false;
    state.active = true;
    const session = ++state.session;
    panel.style.display = 'flex';
    status.textContent = 'Buscando PDF417…';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const W = video.videoWidth, H = video.videoHeight;
    if (!W || !H) { status.textContent = 'La cámara no entregó imagen'; button.disabled = false; return; }
    const sx = Math.floor(W * .1), sy = Math.floor(H * .39);
    const sw = Math.floor(W * .8), sh = Math.floor(H * .22);
    canvas.width = sw; canvas.height = sh;
    const started = performance.now(); let attempts = 0;
    while (state.active && !state.closed && session === state.session) {
      try {
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
        const results = await state.reader(ctx.getImageData(0, 0, sw, sh), {
          formats: ['PDF417'], tryHarder: true, tryRotate: true,
          tryDownscale: false, maxNumberOfSymbols: 1
        });
        if (!state.active || session !== state.session || state.closed) return;
        attempts++;
        const elapsed = ((performance.now() - started) / 1000).toFixed(2);
        const result = results.find(r => r.isValid);
        if (result) {
          const fields = result.text.split('@');
          if (fields.length < 5 || !/^\d{7,8}$/.test(fields[4]?.trim())) {
            status.textContent = 'Código detectado, formato no reconocido';
            console.warn('PDF417 no reconocido; longitud:', result.text.length);
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
          const name = (fields[1] + ' ' + fields[2]).trim();
          const dni = fields[4].trim();
          if (!document.querySelector('input[name="name"]') || !document.querySelector('input[name="dni"]')) {
            throw Error('No se encuentran los campos name y dni');
          }
          fill('input[name="name"]', name);
          fill('input[name="dni"]', dni);
          console.log('DNI leído en ' + elapsed + ' segundos; intentos: ' + attempts);
          hide(); return;
        }
        if (attempts % 5 === 0) status.textContent = 'Buscando PDF417… ' + elapsed + ' s · ' + attempts + ' intentos';
        await new Promise(r => setTimeout(r, 0));
      } catch (e) {
        if (state.active && session === state.session) {
          status.textContent = 'Error: ' + e.message;
          console.error(e);
          hide();
        }
        return;
      }
    }
  }

  async function prepare() {
    if (!state.reader) {
      const module = await import('https://esm.sh/zxing-wasm@3.1.4/reader');
      state.reader = module.readBarcodes;
    }
    if (state.closed) return;
    if (!state.stream?.active) {
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
        });
      } catch (e) {
        if (!mobile) throw e;
        state.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      if (state.closed) { state.stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = state.stream;
      await video.play();
    }
    button.textContent = '📷'; button.disabled = false;
  }

  window.__dniScannerPersistent = { open, dispose };
  button.onclick = open;
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.active) hide(); });
  try { if (mobile) {
    button.textContent = '📷'; button.disabled = false;
    const module = await import('https://esm.sh/zxing-wasm@3.1.4/reader');
    state.reader = module.readBarcodes;
  } else await prepare(); }
  catch (e) {
    button.textContent = '📷'; button.title = 'Reintentar escáner'; button.disabled = false;
    button.onclick = open;
    console.error('Error preparando escáner:', e);
  }
})();
