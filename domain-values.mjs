// Valeurs partagées par les API et les rapports : FCFA entiers, dates Dakar (UTC).
export function amount(value, label = 'Montant', positive = false) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
  if (!Number.isSafeInteger(n) || n < (positive ? 1 : 0)) {
    throw Object.assign(new Error(`${label} invalide : un entier positif en FCFA est requis.`), { status: 422, code: 'DATA_INTEGRITY' });
  }
  return n;
}

export function civilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

export function recordTimestamp(record) {
  for (const key of ['date_heure_ts', 'date_ts']) {
    if (record[key] != null) {
      const value = typeof record[key] === 'number' ? record[key] : (/^\d+$/.test(String(record[key])) ? Number(record[key]) : NaN);
      return Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000 ? value : NaN;
    }
  }
  const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(record.date || ''));
  if (!date) return NaN;
  const iso = `${date[3]}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}`;
  if (!civilDate(iso)) return NaN;
  const time = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(record.heure || '00:00'));
  if (!time || Number(time[1]) > 23 || Number(time[2]) > 59) return NaN;
  return Date.parse(`${iso}T${time[1].padStart(2, '0')}:${time[2]}:00.000Z`);
}

export function sumAmounts(records, field, activeOnly = false) {
  let total = 0;
  for (const record of records) {
    if (record.annule != null && typeof record.annule !== 'boolean') throw Object.assign(new Error('Statut d’annulation invalide.'), {status:409,code:'DATA_INTEGRITY'});
    if (activeOnly && record.annule === true) continue;
    total += amount(record[field], `Champ ${field}`);
    if (!Number.isSafeInteger(total)) throw Object.assign(new Error('Total hors limites : rapprochement des données requis.'), { status: 409, code: 'DATA_INTEGRITY' });
  }
  return total;
}
