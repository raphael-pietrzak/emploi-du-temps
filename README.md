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

- `js/storage.js` — persistance (localStorage), interface prête pour un backend futur
- `js/solver.js` — moteur de génération par backtracking, fonction pure
- `js/ui.js` — rendu et interactions (drag-to-paint)
- `js/app.js` — point d'entrée
