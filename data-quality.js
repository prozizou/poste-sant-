import { amount, recordTimestamp } from './domain-values.mjs';

const groups = new Map();
export function checkDataQuality(records, group = 'default') {
    groups.set(group,records);
    records=[...groups.values()].flat();
    let invalid = 0, undated = 0, future = 0;
    for (const row of records) {
        try {
            const field = Object.hasOwn(row,'montant') ? 'montant' : Object.hasOwn(row,'total') ? 'total' : 'prix';
            amount(row[field],field);
            if (row.annule != null && typeof row.annule !== 'boolean') invalid++;
        } catch { invalid++; }
        const ts=recordTimestamp(row);
        if (!Number.isFinite(ts)) undated++;
        else if (ts>Date.now()) future++;
    }
    let box=document.getElementById('data-quality');
    if (!invalid && !undated && !future) { box?.remove();return true; }
    if (!box) {
        box=document.createElement('div');box.id='data-quality';box.setAttribute('role','alert');
        box.style.cssText='position:sticky;top:0;z-index:9999;padding:16px;background:#fff1f0;color:#8b1e18;border:2px solid #bc2c25;font:600 14px/1.5 system-ui;';
        document.body.prepend(box);
    }
    box.textContent=invalid ? `Calculs suspendus : ${invalid} enregistrement(s) contiennent des montants ou statuts invalides. Un rapprochement des données est nécessaire.`
        : `Données à vérifier : ${undated} enregistrement(s) sans date exploitable et ${future} daté(s) dans le futur sont exclus des périodes affichées.`;
    if (invalid) {
        // Cover stale figures too: a previously rendered total is not reliable.
        box.style.position='fixed';box.style.inset='0';box.style.padding='15vh 24px';
    } else {
        box.style.position='sticky';box.style.inset='auto';box.style.padding='16px';
    }
    return invalid===0;
}
