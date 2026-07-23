// io.js — import/export du state.

Object.assign(UI, {
  bindIO() {
    document.getElementById('export-btn').addEventListener('click', () => Storage.export(this.state));
    document.getElementById('import-input').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const s = await Storage.import(f);
        Object.assign(this.state, s);
        this.onChange();
        this.renderAll();
        alert('Import réussi.');
      } catch (err) { alert('Import échoué : ' + err.message); }
    });
  },
});
