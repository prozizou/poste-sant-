// Vérification centralisée : rôle ET village actif depuis la base (pas le navigateur).
import { villagePourUtilisateur } from './village-client.js';
export async function roleServeur(user) {
  const contexte = await villagePourUtilisateur(user);
  return contexte?.role || '';
}
