(function () {
  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const w16 = (view, offset, value) => view.setUint16(offset, value, true);
  const w32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);
  function makeZip(files) {
    const local = [], central = [];
    let offset = 0;
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = file.data instanceof Uint8Array ? file.data : encoder.encode(String(file.data));
      const crc = crc32(data);
      const head = new Uint8Array(30 + name.length), hv = new DataView(head.buffer);
      w32(hv, 0, 0x04034b50); w16(hv, 4, 20); w16(hv, 6, 0x0800); w16(hv, 8, 0);
      w16(hv, 10, time); w16(hv, 12, date); w32(hv, 14, crc); w32(hv, 18, data.length);
      w32(hv, 22, data.length); w16(hv, 26, name.length); w16(hv, 28, 0); head.set(name, 30);
      local.push(head, data);
      const entry = new Uint8Array(46 + name.length), ev = new DataView(entry.buffer);
      w32(ev, 0, 0x02014b50); w16(ev, 4, 20); w16(ev, 6, 20); w16(ev, 8, 0x0800); w16(ev, 10, 0);
      w16(ev, 12, time); w16(ev, 14, date); w32(ev, 16, crc); w32(ev, 20, data.length); w32(ev, 24, data.length);
      w16(ev, 28, name.length); w16(ev, 30, 0); w16(ev, 32, 0); w16(ev, 34, 0); w16(ev, 36, 0);
      w32(ev, 38, 0); w32(ev, 42, offset); entry.set(name, 46); central.push(entry);
      offset += head.length + data.length;
    }
    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    w32(ev, 0, 0x06054b50); w16(ev, 4, 0); w16(ev, 6, 0); w16(ev, 8, files.length); w16(ev, 10, files.length);
    w32(ev, 12, centralSize); w32(ev, 16, offset); w16(ev, 20, 0);
    return new Blob([...local, ...central, end], { type: 'application/zip' });
  }
  const safeName = (value) => String(value || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 100) || 'file';
  async function readMedia(source) {
    if (!source) return null;
    try { return new Uint8Array(await (await fetch(source)).arrayBuffer()); } catch (_) { return null; }
  }
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('export-chat-button');
    const status = document.getElementById('export-chat-status');
    if (!button || !status) return;
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'Menyiapkan arsip chat lokal…';
      try {
        if (!window.CallMeStorage || typeof window.CallMeStorage.all !== 'function') throw new Error('Penyimpanan chat belum siap');
        const rows = await window.CallMeStorage.all('messages');
        const files = [], messages = [];
        let mediaCount = 0;
        for (const row of rows || []) {
          const item = { ...row };
          const source = item.source || item.audio || '';
          delete item.source; delete item.audio;
          if (['media', 'audio', 'file'].includes(row.kind)) {
            const bytes = await readMedia(source);
            if (bytes) {
              const extension = safeName(row.name).match(/\.[a-z0-9]{1,8}$/i);
              const path = 'media/' + String(row.createdAt || 0) + '-' + safeName(row.id || mediaCount) + '-' + mediaCount + (extension ? extension[0] : '');
              files.push({ name: path, data: bytes }); item.exportedMedia = path; mediaCount += 1;
            } else item.exportedMedia = null;
          }
          messages.push(item);
        }
        files.unshift({ name: 'messages.json', data: JSON.stringify({ format: 'CallMe chat export v1', exportedAt: new Date().toISOString(), messageCount: messages.length, mediaCount, messages }, null, 2) });
        files.unshift({ name: 'README.txt', data: 'Ekspor chat CallMe dari penyimpanan lokal perangkat ini. Lampiran yang masih tersedia ada di folder media/.\r\n' });
        const blob = makeZip(files);
        const url = URL.createObjectURL(blob), anchor = document.createElement('a');
        anchor.href = url; anchor.download = 'CallMe-chat-' + new Date().toISOString().replace(/[:.]/g, '-') + '.zip';
        document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        status.textContent = messages.length + ' pesan dan ' + mediaCount + ' file media diekspor. Periksa unduhan browser.';
      } catch (error) {
        console.error('Ekspor chat gagal', error);
        status.textContent = 'Ekspor gagal: ' + (error && error.message ? error.message : 'coba muat ulang halaman.');
      } finally { button.disabled = false; }
    });
  });
})();
