# Emploi du temps

Générateur d'emploi du temps scolaire (collège) à partir des disponibilités des professeurs.

Application 100% statique : HTML / CSS / JS vanilla, aucune dépendance, aucun build.

## Utilisation

Ouvrir `index.html` dans un navigateur, ou visiter la version déployée.

1. **Configuration** — classes, matières, grille horaire, volumes horaires par matière/classe.
2. **Professeurs & dispos** — ajouter les profs, cocher leurs matières, peindre leurs indisponibilités à la souris (tout est disponible par défaut).
3. **Emploi du temps** — bouton *Générer*, puis vue par classe ou par prof.

Les données sont sauvegardées dans le navigateur (localStorage) et peuvent être exportées / importées en JSON.

## Architecture

Application vanilla sans build ni modules ES : chaque script est chargé par `index.html` et attache son API à un objet global (`Storage`, `Solver`, `UI`). Les fichiers `js/ui/*.js` étendent tous le même objet `UI` via `Object.assign`.

### Rôle des fichiers (contexte IA)

| Fichier | Rôle |
|---|---|
| `index.html` | Structure DOM, 4 onglets, chargement des scripts (ordre important : `core.js` avant les extensions, `app.js` en dernier) |
| `style.css` | Styles globaux + thème clair/sombre via `data-theme` |
| `js/app.js` | Point d'entrée : charge le state, initialise `UI`, gère le thème |
| `js/storage.js` | Persistance localStorage + import/export JSON + `defaultState()` |
| `js/solver.js` | Moteur de génération par backtracking (fonction pure `Solver.solve(state)`) |
| `js/ui/core.js` | État partagé de `UI`, `init()`, `renderAll()`, helper `bindEnterToClick` |
| `js/ui/tabs.js` | Bascule d'onglets |
| `js/ui/io.js` | Boutons import / export |
| `js/ui/config.js` | Onglet Configuration : classes, matières, créneaux, jours, options, matrice des volumes |
| `js/ui/profs.js` | Onglet Professeurs : liste, éditeur matières/classes, grille de dispos (drag-to-paint) |
| `js/ui/constraints.js` | Onglet Contraintes : épingles (créneaux fixés) et préférences horaires par matière |
| `js/ui/schedule.js` | Onglet Emploi du temps : génération + rendus (vue classe / prof / global) |
| `js/ui/swap.js` | Échange interactif de deux cellules dans la grille, avec règles de validité |

### Forme du state

```
{ config: { classes, subjects, slots, days, activeDays },
  volumes: { "classe|matière": heures },
  profs:   [{ id, name, subjectClasses: {matière: [classes]}, availability: [jours][slots] }],
  constraints: { pins: [...], timePref: {matière: 'early'|'any'|'late'} },
  options: { noGapsForStudents, randomize },
  schedule: { "classe|jour|slot": { subj, profId, pinned } } | null }
```
