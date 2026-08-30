// zip.js — écrivain ZIP minimal (méthode "store", sans compression), pour
// pouvoir télécharger plusieurs fichiers d'un coup sans dépendance externe
// (le projet n'a ni npm ni bundler — voir CLAUDE.md). Suffisant ici car on
// zippe des PNG déjà compressés : la compression ZIP n'apporterait rien.

const Zip = (() => {
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date) {
    const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() >> 1) & 0x1F);
    const day = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0xF) << 5) | (date.getDate() & 0x1F);
    return { time, day };
  }

  // files: [{ name: string, data: Uint8Array }] -> Blob (application/zip)
  function build(files) {
    const encoder = new TextEncoder();
    const now = new Date();
    const { time, day } = dosDateTime(now);
    const UTF8_FLAG = 0x0800;

    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach(f => {
      const nameBytes = encoder.encode(f.name);
      const data = f.data;
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);           // version needed
      local.setUint16(6, UTF8_FLAG, true);    // flags
      local.setUint16(8, 0, true);            // method: store
      local.setUint16(10, time, true);
      local.setUint16(12, day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); // compressed size
      local.setUint32(22, data.length, true); // uncompressed size
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);           // extra length
      localParts.push(new Uint8Array(local.buffer), nameBytes, data);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);         // version made by
      central.setUint16(6, 20, true);         // version needed
      central.setUint16(8, UTF8_FLAG, true);  // flags
      central.setUint16(10, 0, true);         // method: store
      central.setUint16(12, time, true);
      central.setUint16(14, day, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, data.length, true);
      central.setUint32(24, data.length, true);
      central.setUint16(28, nameBytes.length, true);
      central.setUint16(30, 0, true);         // extra length
      central.setUint16(32, 0, true);         // comment length
      central.setUint16(34, 0, true);         // disk number start
      central.setUint16(36, 0, true);         // internal attrs
      central.setUint32(38, 0, true);         // external attrs
      central.setUint32(42, offset, true);    // local header offset
      centralParts.push(new Uint8Array(central.buffer), nameBytes);

      offset += local.byteLength + nameBytes.length + data.length;
    });

    const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
    const centralOffset = offset;

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, centralOffset, true);
    end.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  return { build };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Zip;
