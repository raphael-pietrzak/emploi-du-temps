// core.js — état partagé + init + helpers communs à toutes les sections d'UI.
// Les autres fichiers ui/*.js étendent cet objet via Object.assign(UI, {...}).

const UI = {
  state: null,
  selectedProfId: null,
  onChange: null,

  init(state, onChange) {
    this.state = state;
    this.onChange = onChange;
    // Migration : ancien state sans contraintes.
    if (!this.state.constraints) this.state.constraints = { pins: [], timePref: {} };
    if (!this.state.constraints.pins) this.state.constraints.pins = [];
    if (!this.state.constraints.timePref) this.state.constraints.timePref = {};
    this.bindTabs();
    this.bindIO();
    this.bindConfig();
    this.bindProfs();
    this.bindConstraints();
    this.bindSchedule();
    this.renderAll();
  },

  bindEnterToClick(inputId, buttonId) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById(buttonId).click();
      }
    });
  },

  renderAll() {
    this.renderConfig();
    this.renderProfs();
    this.renderConstraints();
    this.renderSchedule();
  },
};
