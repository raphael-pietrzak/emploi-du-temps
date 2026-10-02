(function () {
  "use strict";

  // ---------- Backend partagé (Supabase) ----------
  // Toutes les données (profs, créneaux, réservations) vivent côté serveur
  // pour que tous les parents, sur leurs propres appareils, voient et
  // modifient le même planning. Seul "votre nom" reste local (localStorage) :
  // ce n'est qu'une commodité pour ne pas le retaper à chaque onglet.
  var SUPABASE_URL = "https://qezydwssdqlamwozkmle.supabase.co";
  var SUPABASE_KEY = "sb_publishable_aY3AG2iuzqwai5b3Yaz8XA_M93lsS0H";
  var POLL_MS = 4000;
  var RENAME_DEBOUNCE_MS = 600;
  var IDENTITY_KEY = "rdvIdentityName";

  var DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

  function sb(path, opts) {
    opts = opts || {};
    var headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json"
    };
    Object.keys(opts.headers || {}).forEach(function (k) { headers[k] = opts.headers[k]; });
    return fetch(SUPABASE_URL + "/rest/v1/" + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          var err = new Error(text || res.statusText);
          err.status = res.status;
          throw err;
        });
      }
      if (res.status === 204) return null;
      return res.text().then(function (text) { return text ? JSON.parse(text) : null; });
    });
  }

  // ---------- Local, in-memory mirror of the shared data ----------
  var profs = [];
  var activeProfId = null;
  var identityName = localStorage.getItem(IDENTITY_KEY) || "";
  var renameBaseName = identityName; // nom tel qu'il est actuellement sur le serveur

  // Runtime-only UI state, never persisted.
  var ui = {
    addingProf: false,
    editingProfId: null,
    selectedCells: null, // Set of "day|time" while the agenda editor is open
    painting: false,
    paintValue: true,
    draggingProfId: null // id of the prof tab currently being dragged to reorder
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function slotId(day, time) {
    return day + "|" + time;
  }

  function sameIdentity(a, b) {
    if (!a || !b) return false;
    return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
  }

  function identityFilled() {
    return identityName.trim() !== "";
  }

  // Corriger son nom (faute de frappe, etc.) ne doit pas faire perdre ses
  // propres réservations déjà faites sous l'ancien texte : on les renomme
  // avec lui (localement tout de suite, côté serveur après une pause de
  // frappe), au lieu de les traiter comme appartenant à quelqu'un d'autre.
  var renameTimer = null;
  function renameIdentity(newName) {
    var oldLocal = identityName.trim().toLowerCase();
    if (oldLocal) {
      profs.forEach(function (prof) {
        Object.keys(prof.bookings).forEach(function (key) {
          if (prof.bookings[key].name.trim().toLowerCase() === oldLocal) {
            prof.bookings[key] = { name: newName };
          }
        });
      });
    }
    identityName = newName;
    localStorage.setItem(IDENTITY_KEY, newName);

    clearTimeout(renameTimer);
    renameTimer = setTimeout(function () {
      var base = renameBaseName.trim();
      renameBaseName = identityName;
      if (base) {
        sb("bookings?name=ilike." + encodeURIComponent(base), {
          method: "PATCH",
          body: { name: identityName }
        }).catch(function (e) { console.error("Renommage distant échoué :", e); });
      }
    }, RENAME_DEBOUNCE_MS);
  }

  // ---------- Time helpers ----------
  function timeToMinutes(t) {
    var parts = t.split(":");
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }
  function minutesToTime(m) {
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return (h < 10 ? "0" : "") + h + "h" + (mm < 10 ? "0" : "") + mm;
  }
  function buildTimeRange(start, end, step) {
    var out = [];
    var startM = timeToMinutes(start);
    var endM = timeToMinutes(end);
    for (var m = startM; m < endM; m += step) {
      out.push(minutesToTime(m));
    }
    return out;
  }

  function getActiveProf() {
    return profs.find(function (p) { return p.id === activeProfId; }) || null;
  }

  // ---------- Remote data sync ----------
  function refreshProfs() {
    return Promise.all([
      sb("profs?select=id,name,start_time,end_time,step,sort_order&order=sort_order.asc"),
      sb("slots?select=prof_id,day,time"),
      sb("bookings?select=prof_id,day,time,name")
    ]).then(function (results) {
      var profRows = results[0] || [];
      var slotRows = results[1] || [];
      var bookingRows = results[2] || [];

      var byId = {};
      profRows.forEach(function (r) {
        byId[r.id] = {
          id: r.id,
          name: r.name,
          startTime: r.start_time,
          endTime: r.end_time,
          step: r.step,
          sortOrder: r.sort_order,
          slots: [],
          bookings: {}
        };
      });
      slotRows.forEach(function (s) {
        var p = byId[s.prof_id];
        if (p) p.slots.push({ day: s.day, time: s.time });
      });
      bookingRows.forEach(function (b) {
        var p = byId[b.prof_id];
        if (p) p.bookings[slotId(b.day, b.time)] = { name: b.name };
      });

      profs = profRows.map(function (r) { return byId[r.id]; });
      if (!activeProfId || !profs.some(function (p) { return p.id === activeProfId; })) {
        activeProfId = profs.length ? profs[0].id : null;
      }
    });
  }

  // ---------- Remote mutations ----------
  function addProf(name) {
    var id = uid();
    var maxOrder = profs.reduce(function (m, p) { return Math.max(m, p.sortOrder); }, -1);
    return sb("profs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: [{ id: id, name: name, start_time: "16:00", end_time: "19:00", step: 10, sort_order: maxOrder + 1 }]
    }).then(refreshProfs).then(function () {
      activeProfId = id;
      ui.editingProfId = id; // brand new prof -> straight into the agenda editor
      ui.selectedCells = new Set();
      render();
    }).catch(function (e) {
      alert("Impossible d'ajouter ce professeur (connexion au serveur).");
      console.error(e);
    });
  }

  function deleteProf(prof) {
    sb("profs?id=eq." + encodeURIComponent(prof.id), { method: "DELETE" })
      .then(refreshProfs)
      .then(render)
      .catch(function (e) {
        alert("Impossible de supprimer ce professeur (connexion au serveur).");
        console.error(e);
      });
  }

  function persistOrder() {
    var updates = profs.map(function (p, i) {
      p.sortOrder = i;
      return sb("profs?id=eq." + encodeURIComponent(p.id), { method: "PATCH", body: { sort_order: i } });
    });
    Promise.all(updates).catch(function (e) { console.error("Réordonnancement non sauvegardé :", e); });
  }

  function commitSlots(prof) {
    var newSlots = [];
    ui.selectedCells.forEach(function (id) {
      var parts = id.split("|");
      newSlots.push({ day: parts[0], time: parts[1] });
    });

    var existingKeys = {};
    prof.slots.forEach(function (s) { existingKeys[slotId(s.day, s.time)] = s; });
    var newKeys = {};
    newSlots.forEach(function (s) { newKeys[slotId(s.day, s.time)] = s; });

    var toDelete = Object.keys(existingKeys).filter(function (k) { return !newKeys[k]; }).map(function (k) { return existingKeys[k]; });
    var toAdd = Object.keys(newKeys).filter(function (k) { return !existingKeys[k]; }).map(function (k) { return newKeys[k]; });

    var ops = [];
    if (toDelete.length) {
      var orExpr = toDelete.map(function (s) {
        return "and(day.eq." + encodeURIComponent(s.day) + ",time.eq." + encodeURIComponent(s.time) + ")";
      }).join(",");
      ops.push(sb("slots?prof_id=eq." + encodeURIComponent(prof.id) + "&or=(" + orExpr + ")", { method: "DELETE" }));
    }
    if (toAdd.length) {
      ops.push(sb("slots", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: toAdd.map(function (s) { return { prof_id: prof.id, day: s.day, time: s.time }; })
      }));
    }

    Promise.all(ops).then(refreshProfs).then(function () {
      ui.editingProfId = null;
      ui.selectedCells = null;
      render();
    }).catch(function (e) {
      alert("Échec de l'enregistrement des créneaux (connexion au serveur).");
      console.error(e);
    });
  }

  function updateProfTiming(prof) {
    sb("profs?id=eq." + encodeURIComponent(prof.id), {
      method: "PATCH",
      body: { start_time: prof.startTime, end_time: prof.endTime, step: prof.step }
    }).catch(function (e) { console.error("Horaires non sauvegardés :", e); });
  }

  function bookSlot(prof, day, time) {
    return sb("bookings", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: [{ prof_id: prof.id, day: day, time: time, name: identityName }]
    }).then(refreshProfs).then(render).catch(function (err) {
      if (err.status === 409) {
        alert("Ce créneau vient d'être réservé par quelqu'un d'autre.");
      } else {
        alert("Échec de la réservation (connexion au serveur).");
        console.error(err);
      }
      return refreshProfs().then(render);
    });
  }

  function releaseSlot(prof, day, time) {
    return sb(
      "bookings?prof_id=eq." + encodeURIComponent(prof.id) +
      "&day=eq." + encodeURIComponent(day) +
      "&time=eq." + encodeURIComponent(time) +
      "&name=eq." + encodeURIComponent(identityName),
      { method: "DELETE" }
    ).then(refreshProfs).then(render).catch(function (e) {
      alert("Échec de l'annulation (connexion au serveur).");
      console.error(e);
      return refreshProfs().then(render);
    });
  }

  // ---------- Rendering ----------
  function render() {
    renderTabs();
    renderMain();
  }

  function renderPreservingFocus() {
    var active = document.activeElement;
    var activeId = active && active.id;
    var selStart = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
    var selEnd = active && typeof active.selectionEnd === "number" ? active.selectionEnd : null;

    render();

    if (activeId) {
      var el = document.getElementById(activeId);
      if (el) {
        el.focus();
        if (selStart !== null) el.setSelectionRange(selStart, selEnd);
      }
    }
  }

  function renderTabs() {
    var tabsList = document.getElementById("tabsList");
    tabsList.innerHTML = "";

    profs.forEach(function (prof) {
      var btn = document.createElement("button");
      btn.className = "tab-btn" + (prof.id === activeProfId ? " active" : "");
      btn.type = "button";
      btn.draggable = true;
      btn.dataset.profId = prof.id;

      var label = document.createTextNode(prof.name);
      btn.appendChild(label);

      btn.addEventListener("dragstart", function (e) {
        ui.draggingProfId = prof.id;
        btn.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", prof.id);
      });
      btn.addEventListener("dragend", function () {
        ui.draggingProfId = null;
        btn.classList.remove("dragging");
      });
      btn.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });
      btn.addEventListener("dragenter", function () {
        if (ui.draggingProfId && ui.draggingProfId !== prof.id) {
          btn.classList.add("drag-over");
        }
      });
      btn.addEventListener("dragleave", function () {
        btn.classList.remove("drag-over");
      });
      btn.addEventListener("drop", function (e) {
        e.preventDefault();
        btn.classList.remove("drag-over");
        var draggedId = ui.draggingProfId;
        if (!draggedId || draggedId === prof.id) return;
        var fromIdx = profs.findIndex(function (p) { return p.id === draggedId; });
        var toIdx = profs.findIndex(function (p) { return p.id === prof.id; });
        if (fromIdx === -1 || toIdx === -1) return;
        var moved = profs.splice(fromIdx, 1)[0];
        profs.splice(toIdx, 0, moved);
        ui.draggingProfId = null;
        render();
        persistOrder();
      });

      var del = document.createElement("span");
      del.className = "del-x";
      del.textContent = "✕";
      del.title = "Supprimer ce professeur";
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        if (confirm('Supprimer "' + prof.name + '" et tous ses créneaux (pour tout le monde) ?')) {
          deleteProf(prof);
        }
      });
      btn.appendChild(del);

      btn.addEventListener("click", function () {
        activeProfId = prof.id;
        ui.editingProfId = null;
        render();
      });

      tabsList.appendChild(btn);
    });

    if (ui.addingProf) {
      var wrap = document.createElement("div");
      wrap.className = "new-prof-inline";

      var input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Nom du professeur";
      input.id = "newProfInput";

      var confirmBtn = document.createElement("button");
      confirmBtn.textContent = "Ajouter";
      confirmBtn.type = "button";

      function commit() {
        var name = input.value.trim();
        ui.addingProf = false;
        if (name) {
          addProf(name);
        } else {
          render();
        }
      }

      confirmBtn.addEventListener("click", commit);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { ui.addingProf = false; render(); }
      });

      wrap.appendChild(input);
      wrap.appendChild(confirmBtn);
      tabsList.appendChild(wrap);

      setTimeout(function () { input.focus(); }, 0);
    }
  }

  function renderMain() {
    var app = document.getElementById("app");
    app.innerHTML = "";

    var prof = getActiveProf();
    if (!prof) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = profs.length
        ? "Choisissez un professeur en haut."
        : "Ajoutez un professeur avec le bouton + en haut à droite pour commencer.";
      app.appendChild(empty);
      return;
    }

    var layout = document.createElement("div");
    layout.className = "prof-layout";

    layout.appendChild(renderIdentityPanel());
    layout.appendChild(
      ui.editingProfId === prof.id ? renderAgendaEditor(prof) : renderBookingPanel(prof)
    );

    app.appendChild(layout);
  }

  function renderIdentityPanel() {
    var panel = document.createElement("div");
    panel.className = "card identity-panel";

    var h2 = document.createElement("h2");
    h2.textContent = "Votre nom";
    panel.appendChild(h2);

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Nom et prénom";
    nameInput.value = identityName;
    nameInput.id = "nameInput";

    var hint = document.createElement("div");
    hint.className = "identity-hint";
    hint.textContent = "Renseignez votre nom et prénom pour réserver un créneau.";
    hint.id = "identityHint";

    nameInput.addEventListener("input", function () {
      renameIdentity(nameInput.value);
      renderPreservingFocus();
    });

    panel.appendChild(nameInput);
    panel.appendChild(hint);

    return panel;
  }

  function renderBookingPanel(prof) {
    var panel = document.createElement("div");
    panel.className = "card main-panel";

    var h2 = document.createElement("h2");
    h2.textContent = prof.name;
    panel.appendChild(h2);

    var subtitle = document.createElement("div");
    subtitle.className = "hint";
    subtitle.textContent = "Cliquez sur un créneau libre pour le réserver. Visible par tous les parents.";
    panel.appendChild(subtitle);

    var editLink = document.createElement("button");
    editLink.className = "edit-slots-link";
    editLink.type = "button";
    editLink.textContent = prof.slots.length ? "Modifier les créneaux" : "Définir les créneaux";
    editLink.style.marginBottom = "16px";
    editLink.style.display = "block";
    editLink.addEventListener("click", function () {
      ui.editingProfId = prof.id;
      ui.selectedCells = new Set(
        prof.slots.map(function (s) { return slotId(s.day, s.time); })
      );
      render();
    });
    panel.appendChild(editLink);

    if (!prof.slots.length) {
      var msg = document.createElement("div");
      msg.className = "no-slots-msg";
      msg.textContent = "Aucun créneau défini pour ce professeur pour le moment.";
      panel.appendChild(msg);
      return panel;
    }

    var byDay = {};
    prof.slots.forEach(function (s) {
      (byDay[s.day] = byDay[s.day] || []).push(s);
    });

    DAYS.filter(function (d) { return byDay[d]; }).forEach(function (day) {
      var dayBlock = document.createElement("div");
      dayBlock.className = "day-block";

      var title = document.createElement("div");
      title.className = "day-title";
      title.textContent = day;
      dayBlock.appendChild(title);

      var row = document.createElement("div");
      row.className = "slot-row";

      byDay[day]
        .slice()
        .sort(function (a, b) { return timeToMinutes(a.time.replace("h", ":")) - timeToMinutes(b.time.replace("h", ":")); })
        .forEach(function (s) {
          row.appendChild(renderSlotChip(prof, s));
        });

      dayBlock.appendChild(row);
      panel.appendChild(dayBlock);
    });

    return panel;
  }

  function renderSlotChip(prof, s) {
    var id = slotId(s.day, s.time);
    var booking = prof.bookings[id];
    var mine = booking && identityFilled() && sameIdentity(booking, { name: identityName });
    var takenByOther = booking && !mine;

    var chip = document.createElement("div");
    chip.className = "slot-chip" + (takenByOther ? " taken-other" : "") + (!identityFilled() && !mine ? " disabled" : "");

    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "slot-" + prof.id + "-" + id;
    cb.checked = !!mine;
    cb.disabled = takenByOther || (!identityFilled() && !mine);

    cb.addEventListener("change", function () {
      if (!identityFilled()) {
        document.getElementById("identityHint").classList.add("show");
        document.getElementById("nameInput").focus();
        cb.checked = false;
        return;
      }
      cb.disabled = true;
      if (cb.checked) {
        bookSlot(prof, s.day, s.time);
      } else {
        releaseSlot(prof, s.day, s.time);
      }
    });

    var label = document.createElement("label");
    label.setAttribute("for", cb.id);
    var timeText = document.createTextNode(s.time);
    label.appendChild(timeText);

    if (takenByOther) {
      var takenName = document.createElement("span");
      takenName.className = "taken-name";
      takenName.textContent = "pris";
      label.appendChild(takenName);
    } else if (mine) {
      var mineName = document.createElement("span");
      mineName.className = "taken-name";
      mineName.textContent = "vous";
      label.appendChild(mineName);
    }

    chip.appendChild(cb);
    chip.appendChild(label);
    return chip;
  }

  // ---------- Agenda editor (drag-select weekly grid) ----------
  function renderAgendaEditor(prof) {
    var panel = document.createElement("div");
    panel.className = "card main-panel";

    var h2 = document.createElement("h2");
    h2.textContent = "Créneaux de " + prof.name;
    panel.appendChild(h2);

    var hint = document.createElement("div");
    hint.className = "editor-hint hint";
    hint.textContent = "Cliquez-glissez sur la grille pour sélectionner les créneaux disponibles, puis validez.";
    panel.appendChild(hint);

    var toolbar = document.createElement("div");
    toolbar.className = "editor-toolbar";

    var startField = makeTimeField("Début", "startTimeInput", prof.startTime);
    var endField = makeTimeField("Fin", "endTimeInput", prof.endTime);

    var stepField = document.createElement("div");
    stepField.className = "field";
    var stepLabel = document.createElement("label");
    stepLabel.textContent = "Durée (min)";
    var stepSelect = document.createElement("select");
    stepSelect.id = "stepSelect";
    [5, 10, 15, 20, 30].forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      if (v === prof.step) opt.selected = true;
      stepSelect.appendChild(opt);
    });
    stepField.appendChild(stepLabel);
    stepField.appendChild(stepSelect);

    var regenBtn = document.createElement("button");
    regenBtn.type = "button";
    regenBtn.textContent = "Mettre à jour la grille";
    regenBtn.addEventListener("click", function () {
      prof.startTime = document.getElementById("startTimeInput").value || prof.startTime;
      prof.endTime = document.getElementById("endTimeInput").value || prof.endTime;
      prof.step = parseInt(document.getElementById("stepSelect").value, 10);
      updateProfTiming(prof);
      render();
    });

    toolbar.appendChild(startField);
    toolbar.appendChild(endField);
    toolbar.appendChild(stepField);
    toolbar.appendChild(regenBtn);
    panel.appendChild(toolbar);

    panel.appendChild(buildAgendaGrid(prof));

    var actions = document.createElement("div");
    actions.className = "editor-actions";

    var validateBtn = document.createElement("button");
    validateBtn.className = "primary";
    validateBtn.type = "button";
    validateBtn.textContent = "Valider les créneaux";
    validateBtn.addEventListener("click", function () {
      commitSlots(prof);
    });

    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Annuler";
    cancelBtn.addEventListener("click", function () {
      ui.editingProfId = null;
      ui.selectedCells = null;
      render();
    });

    actions.appendChild(validateBtn);
    actions.appendChild(cancelBtn);
    panel.appendChild(actions);

    return panel;
  }

  function makeTimeField(labelText, id, value) {
    var field = document.createElement("div");
    field.className = "field";
    var label = document.createElement("label");
    label.textContent = labelText;
    var input = document.createElement("input");
    input.type = "time";
    input.id = id;
    input.value = value;
    field.appendChild(label);
    field.appendChild(input);
    return field;
  }

  function buildAgendaGrid(prof) {
    var wrap = document.createElement("div");
    wrap.className = "grid-wrap";

    var times = buildTimeRange(prof.startTime, prof.endTime, prof.step);
    var table = document.createElement("table");
    table.className = "agenda-grid";

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    headRow.appendChild(document.createElement("th"));
    DAYS.forEach(function (day) {
      var th = document.createElement("th");
      th.textContent = day;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");

    times.forEach(function (time) {
      var tr = document.createElement("tr");
      var labelCell = document.createElement("td");
      labelCell.className = "time-label";
      labelCell.textContent = time;
      tr.appendChild(labelCell);

      DAYS.forEach(function (day) {
        var id = slotId(day, time);
        var td = document.createElement("td");
        td.className = "agenda-cell" + (ui.selectedCells.has(id) ? " selected" : "");
        td.dataset.id = id;

        var hasBooking = prof.bookings[id];
        if (hasBooking && ui.selectedCells.has(id)) {
          td.classList.add("existing-booked");
          td.title = "Réservé par " + hasBooking.name;
        }

        td.addEventListener("mousedown", function (e) {
          e.preventDefault();
          ui.painting = true;
          ui.paintValue = !ui.selectedCells.has(id);
          paintCell(td, id);
        });
        td.addEventListener("mouseenter", function () {
          if (ui.painting) paintCell(td, id);
        });

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function paintCell(td, id) {
    if (ui.paintValue) {
      ui.selectedCells.add(id);
      td.classList.add("selected");
    } else {
      ui.selectedCells.delete(id);
      td.classList.remove("selected");
      td.classList.remove("existing-booked");
    }
  }

  document.addEventListener("mouseup", function () {
    ui.painting = false;
  });

  // ---------- Init ----------
  document.getElementById("addProfBtn").addEventListener("click", function () {
    ui.addingProf = true;
    render();
  });

  var app = document.getElementById("app");
  app.innerHTML = '<div class="empty">Chargement…</div>';

  refreshProfs().then(render).catch(function (e) {
    app.innerHTML = '<div class="empty">Impossible de contacter le serveur. Vérifiez votre connexion et rechargez la page.</div>';
    console.error(e);
  });

  setInterval(function () {
    if (ui.editingProfId) return; // ne pas perturber une édition de grille en cours
    refreshProfs().then(renderPreservingFocus).catch(function (e) {
      console.error("Rafraîchissement échoué :", e);
    });
  }, POLL_MS);

  // Thème clair/sombre, partagé avec l'app emploi du temps.
  var THEME_KEY = "edt_theme";
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    var btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = t === "light" ? "Sombre" : "Clair";
  }
  applyTheme(localStorage.getItem(THEME_KEY) || "dark");
  document.getElementById("theme-toggle").addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
})();
