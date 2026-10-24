#!/usr/bin/env node
'use strict';
// Ancienne migration du modèle mono-village : désactivée pour éviter des
// affectations incomplètes (rôle sans village_id) et toute confusion.
console.error('Migration mono-village obsolète. Utilisez migrate-export-diandioly.js pour la migration historique, puis les écrans dédiés pour les nouveaux comptes.');
process.exitCode = 1;
