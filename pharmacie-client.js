// API sécurisée — toutes les mutations financières pharmacie transitent par le serveur.
import { sendOperation } from './business-client.js';
export function nouvelIdOperation() {
    if (!crypto?.randomUUID) throw new Error('Navigateur non compatible avec les identifiants sécurisés.');
    return crypto.randomUUID();
}
export async function operationPharmacie(action, payload, operationId) {
    return sendOperation('/api/pharmacie-operations',action,payload,operationId);
}
