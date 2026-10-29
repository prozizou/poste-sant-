import { auth } from './firebase-config.js';
import { villageActuel } from './village-client.js';

function stable(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+stable(value[k])).join(',') + '}';
}
const PREFIX = 'ps-command:';
const INCREMENTS = new Set(['ticket_creer','depense_creer','stock_creer','encaisser','reappro']);
function slot(action, payload) {
    const context = villageActuel();
    if (!auth.currentUser || !context?.id || context.uid !== auth.currentUser.uid) throw new Error('Session expirée : reconnectez-vous.');
    return PREFIX + context.uid + ':' + context.id + ':' + action + ':' + (payload.key || 'creation');
}
async function request(endpoint, command) {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(endpoint, {
        method: 'POST', headers: {'Content-Type':'application/json', Authorization:'Bearer '+token},
        body: JSON.stringify(command), cache:'no-store',
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || 'Opération non confirmée.'), {status:response.status,notCommitted:result.not_committed===true});
    return result;
}
function recovery(key, pending) {
    let panel = document.getElementById('pending-command');
    if (!panel) {
        panel = document.createElement('div'); panel.id='pending-command';panel.setAttribute('role','alert');
        panel.style.cssText='position:fixed;bottom:12px;left:12px;right:12px;z-index:10000;padding:16px;background:#fff3cd;color:#503a00;border:2px solid #b78600;border-radius:12px;font:14px system-ui;';
        document.body.append(panel);
    }
    panel.replaceChildren();
    const label=document.createElement('p');label.textContent='Une saisie précédente doit être vérifiée avant de modifier ce formulaire. Aucun nouveau panier n’a été envoyé.';
    const button=document.createElement('button');button.type='button';button.textContent='Vérifier la saisie précédente';
    button.onclick=async()=>{
        button.disabled=true;
        try {
            // The immutable original command is retried, never the edited form.
            if (slot(pending.command.action,pending.command)!==key) throw new Error('Le compte ou le village a changé.');
            await request(pending.endpoint,pending.command);
            sessionStorage.removeItem(key);
            label.textContent='Saisie précédente confirmée. Actualisez pour consulter le résultat avant une nouvelle opération.';
            button.textContent='Actualiser';button.disabled=false;button.onclick=()=>location.reload();
        } catch(e) {
            if(e.notCommitted) {
                sessionStorage.removeItem(key);label.textContent='Aucune écriture effectuée. Actualisez pour corriger la saisie.';
                button.textContent='Actualiser';button.onclick=()=>location.reload();
            } else label.textContent=e.message;
            button.disabled=false;
        }
    };
    panel.append(label,button);
}

export async function sendOperation(endpoint, action, payload, operationId) {
    const key=slot(action,payload);
    let pending;
    try { pending=JSON.parse(sessionStorage.getItem(key) || 'null'); }
    catch { throw new Error('État local de commande illisible : vérifier l’historique avant de poursuivre.'); }
    // Ignore display-only derived fields; the server returns authoritative data.
    const normalized=JSON.parse(JSON.stringify(payload));
    delete normalized.operationId;
    if (pending && stable(pending.payload)!==stable(normalized)) {
        recovery(key,pending);
        throw new Error('Saisie modifiée après une erreur : vérifiez d’abord l’opération précédente avec le bouton de récupération.');
    }
    if (!pending) {
        pending={endpoint,payload:normalized,command:{...normalized,action,operationId:operationId || crypto.randomUUID()}};
        // Persist BEFORE sending. If storage is unavailable, no financial write.
        sessionStorage.setItem(key,JSON.stringify(pending));
    }
    try {
        const result=await request(endpoint,pending.command);
        if (INCREMENTS.has(action)) {
            pending.confirmed=true;
            sessionStorage.setItem(key,JSON.stringify(pending));
        } else sessionStorage.removeItem(key);
        return result;
    } catch(e) {
        // A validation refusal confirms that this request did not commit.
        // Ambiguous failures retain the original ID, payload and recovery path.
        if ((e.status>=400 && e.status<500) && (!pending.uncertain && !pending.confirmed || e.notCommitted)) sessionStorage.removeItem(key);
        else {
            pending.uncertain=true;sessionStorage.setItem(key,JSON.stringify(pending));
            recovery(key,pending);
        }
        throw e;
    }
}
export function operationMetier(action,payload,operationId) {
    return sendOperation('/api/business-operations',action,payload,operationId);
}
// A creation is acknowledged only AFTER its form has been reset. If rendering
// or printing fails after the commit, retrying still uses the original ID.
export function completeOperation(action,payload={}) {
    const key=slot(action,payload);
    const pending=JSON.parse(sessionStorage.getItem(key) || 'null');
    if (pending?.confirmed) sessionStorage.removeItem(key);
}

// Pending medical data lives only in the current tab and is purged at logout.
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js';
onAuthStateChanged(auth,user=>{
    for(let i=sessionStorage.length-1;i>=0;i--){
        const key=sessionStorage.key(i);
        if(key?.startsWith(PREFIX) && (!user || !key.startsWith(PREFIX+user.uid+':'))) sessionStorage.removeItem(key);
    }
});
