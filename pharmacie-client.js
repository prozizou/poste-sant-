// API sécurisée — toutes les mutations financières pharmacie transitent par le serveur.
import { auth } from './firebase-config.js';
export function nouvelIdOperation() {
    if (!crypto?.randomUUID) throw new Error('Navigateur non compatible avec les identifiants sécurisés.');
    return crypto.randomUUID();
}
export async function operationPharmacie(action, payload, operationId) {
    if (!auth.currentUser) throw new Error('Session expirée, reconnectez-vous.');
    const token = await auth.currentUser.getIdToken();
    let res;
    try {
        res = await fetch('/api/pharmacie-operations', {
            method:'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ...payload, action, operationId }), cache: 'no-store'
        });
    } catch (e) { throw new Error('Connexion serveur indisponible : opération non confirmée. Réessayer sans modifier le formulaire.'); }
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.ok) throw new Error(result.error || `Service indisponible (HTTP ${res.status}).`);
    return result;
}
