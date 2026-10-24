'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname,'..');
function walk(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d => {
    if (d.name==='node_modules'||d.name==='.git') return [];
    const p=path.join(dir,d.name);
    return d.isDirectory()?walk(p):[p];
  });
}
const files=walk(root).filter(f => /\.(js|html)$/.test(f));
test('Tous les scripts JS et scripts HTML inline sont syntaxiquement valides', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'poste-check-'));
  let count=0;
  try {
    for (const file of files) {
      const source=fs.readFileSync(file,'utf8');
      const blocks=file.endsWith('.js') ? [{body:source,module:true}]
        :[...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
          .filter(m=>m[2].trim()).map(m=>({body:m[2],module:/type=["']module["']/.test(m[1])}));
      for (const block of blocks) {
        const script=path.join(temp,'check-'+count+++(block.module?'.mjs':'.js'));
        fs.writeFileSync(script,block.body);
        const res=spawnSync('node',['--check',script],{encoding:'utf8'});
        assert.equal(res.status,0,`${path.relative(root,file)}: ${res.stderr}`);
      }
    }
    assert.ok(count >= 25, 'Scripts trouvés');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
